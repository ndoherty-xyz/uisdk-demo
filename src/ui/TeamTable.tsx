import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@ui-sdk/react/select";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { fields, type FieldId, type SelectFieldId } from "../data/fields";
import { members, type Member } from "../data/members";
import { readSettings, readSettingsVersion, subscribeSettings, writeSetting } from "../data/settingsStore";
import { usePreviewedRecipe } from "../preview/usePreview";
import { changesFor, matches } from "../recipe/evaluate";
import { format } from "./format";
import { tableVirtualizer } from "./tableVirtualizer";

// Controls ----------

/**
 * Function to render one select setting with a visually hidden generic label ("Role"), so the
 * bridge labels every row's control the same and the row tells them apart. It starts from the
 * store each time its row mounts and writes every change back.
 * @param props.memberId Whose setting it is.
 * @param props.fieldId Which select field this is.
 * @returns The select.
 */
function SettingSelect({ memberId, fieldId }: { memberId: string; fieldId: SelectFieldId }) {
  const field = fields[fieldId];
  const items = field.options.map(([value, label]) => ({ value, label }));
  return (
    <Select
      defaultValue={readSettings(memberId)[fieldId]}
      items={items}
      onValueChange={(value) => writeSetting(memberId, fieldId, value as string)}
    >
      <SelectLabel className="visually-hidden">{field.label}</SelectLabel>
      <SelectTrigger className="select-trigger">
        <SelectValue />
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </SelectTrigger>
      <SelectContent className="select-content">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="select-item">
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Function to render one on/off setting, named by its generic field label. Like `SettingSelect`,
 * it starts from the store and writes back to it.
 * @param props.memberId Whose setting it is.
 * @param props.fieldId Which switch field this is.
 * @returns The switch.
 */
function SettingSwitch({ memberId, fieldId }: { memberId: string; fieldId: "deployAlerts" | "weeklyDigest" }) {
  return (
    <Switch
      aria-label={fields[fieldId].label}
      defaultChecked={readSettings(memberId)[fieldId]}
      onCheckedChange={(checked) => writeSetting(memberId, fieldId, checked)}
      className="switch"
    >
      <SwitchThumb className="switch-thumb" />
    </Switch>
  );
}

// Table ----------

/**
 * Function to render one member's row: details, the four settings, and what a previewed recipe
 * would change, shown next to each control.
 * @param props.member The member.
 * @param props.index Their position in the whole table.
 * @param props.start Where the virtualizer puts the row, in pixels.
 * @param props.previewChanges The previewed recipe's changes for this row; empty when none.
 * @returns The row.
 */
function MemberRow({
  member,
  index,
  start,
  previewChanges,
}: {
  member: Member;
  index: number;
  start: number;
  previewChanges: { field: FieldId; value: string | boolean }[];
}) {
  // What a previewed recipe would set this cell to, next to the control.
  const previewNext = (fieldId: FieldId) => {
    const change = previewChanges.find((candidate) => candidate.field === fieldId);
    return change && <span className="preview-next">→ {format(fieldId, change.value)}</span>;
  };
  return (
    <tr
      data-member-id={member.id}
      data-preview={previewChanges.length > 0 || undefined}
      aria-rowindex={index + 2}
      style={{ transform: `translateY(${start}px)` }}
    >
      <th scope="row" className="name-cell">
        {member.name}
      </th>
      <td>{member.team}</td>
      <td className="muted">{member.title}</td>
      <td className="muted">{member.location}</td>
      <td>
        <SettingSelect memberId={member.id} fieldId="role" />
        {previewNext("role")}
      </td>
      <td>
        <SettingSelect memberId={member.id} fieldId="seat" />
        {previewNext("seat")}
      </td>
      <td>
        <SettingSwitch memberId={member.id} fieldId="deployAlerts" />
        {previewNext("deployAlerts")}
      </td>
      <td>
        <SettingSwitch memberId={member.id} fieldId="weeklyDigest" />
        {previewNext("weeklyDigest")}
      </td>
    </tr>
  );
}

/**
 * Function to render the team table: a sticky header and only the rows in view. Each `<tr>`
 * carries `data-member-id`, the stable key used to resolve refs. Rows a previewed recipe would
 * change carry `data-preview`.
 * @returns The table.
 */
function TeamTable() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const virtualItems = useSyncExternalStore(tableVirtualizer.subscribe, tableVirtualizer.items);
  // Re-render on every settings change, so previews follow the values.
  useSyncExternalStore(subscribeSettings, readSettingsVersion);
  const previewed = usePreviewedRecipe();

  // A hot reload of the virtualizer's module brings a new instance, which needs connecting too.
  useEffect(() => tableVirtualizer.connect(scrollerRef.current!), [tableVirtualizer]);

  return (
    <div className="table-wrap" data-team-table ref={scrollerRef}>
      <table className="team-table" aria-rowcount={members.length + 1}>
        <thead>
          <tr aria-rowindex={1}>
            <th scope="col">Name</th>
            <th scope="col">Team</th>
            <th scope="col">Title</th>
            <th scope="col">Location</th>
            <th scope="col">{fields.role.label}</th>
            <th scope="col">{fields.seat.label}</th>
            <th scope="col">{fields.deployAlerts.label}</th>
            <th scope="col">{fields.weeklyDigest.label}</th>
          </tr>
        </thead>
        <tbody style={{ height: tableVirtualizer.size() }}>
          {virtualItems.map((item) => {
            const member = members[item.index]!;
            const isPreviewed =
              previewed !== null && member.id !== previewed.recordedMemberId && matches(previewed.recipe, member);
            return (
              <MemberRow
                key={item.key}
                member={member}
                index={item.index}
                start={item.start}
                previewChanges={isPreviewed ? changesFor(previewed.recipe, member, readSettings(member.id)) : []}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { TeamTable };
