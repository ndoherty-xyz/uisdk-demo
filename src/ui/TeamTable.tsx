import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@ui-sdk/react/select";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { fields, type FieldId, type SelectFieldId } from "../data/fields";
import { attributeValueCounts, members, type Member, type Team } from "../data/members";
import { readSettings, readSettingsVersion, subscribeSettings, writeSetting } from "../data/settingsStore";
import { usePreviewedRecipe } from "../preview/usePreview";
import { changesFor, matches } from "../recipe/evaluate";
import { format } from "./format";
import {
  readTableQuery,
  readVisibleMembers,
  setTableQuery,
  subscribeTableQuery,
  tableVirtualizer,
  unfilteredQuery,
  type SortColumn,
  type TableQuery,
} from "./tableVirtualizer";

const chevronIcon = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

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
        {chevronIcon}
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

// Toolbar ----------

/**
 * Function to render one toolbar filter: "All teams", or one value.
 * @param props.label What it filters, e.g. "Team".
 * @param props.allLabel The label for no filter, e.g. "All teams".
 * @param props.values The values to pick from.
 * @param props.value The current value; null for all.
 * @param props.onChange Called with the new value; null for all.
 * @returns The select.
 */
function FilterSelect({
  label,
  allLabel,
  values,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  values: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const items = [{ value: "", label: allLabel }, ...values.map((option) => ({ value: option, label: option }))];
  return (
    <Select value={value ?? ""} items={items} onValueChange={(next) => onChange((next as string) || null)}>
      <SelectLabel className="visually-hidden">{label}</SelectLabel>
      <SelectTrigger className="select-trigger" data-active={value !== null || undefined}>
        <SelectValue />
        {chevronIcon}
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
 * Function to render the bar above the table: search, filters, and how many people show.
 * @param props.tableQuery The current filters and sort.
 * @param props.visibleCount How many people the filters leave.
 * @returns The toolbar.
 */
function TableToolbar({ tableQuery, visibleCount }: { tableQuery: TableQuery; visibleCount: number }) {
  const isFiltered = tableQuery.search !== "" || tableQuery.team !== null || tableQuery.location !== null;
  return (
    <div className="table-toolbar" role="search">
      <input
        type="search"
        className="table-search"
        placeholder="Search name or title"
        aria-label="Search people"
        value={tableQuery.search}
        onChange={(event) => setTableQuery({ ...tableQuery, search: event.target.value })}
      />
      <FilterSelect
        label="Team"
        allLabel="All teams"
        values={Object.keys(attributeValueCounts.team).sort()}
        value={tableQuery.team}
        onChange={(team) => setTableQuery({ ...tableQuery, team: team as Team | null })}
      />
      <FilterSelect
        label="Location"
        allLabel="All locations"
        values={Object.keys(attributeValueCounts.location).sort()}
        value={tableQuery.location}
        onChange={(location) => setTableQuery({ ...tableQuery, location })}
      />
      {isFiltered && (
        <button
          type="button"
          className="text-button"
          onClick={() => setTableQuery({ ...unfilteredQuery, sort: tableQuery.sort })}
        >
          Clear
        </button>
      )}
      <span className="table-count muted" aria-live="polite">
        {isFiltered
          ? `${visibleCount.toLocaleString()} of ${members.length.toLocaleString()}`
          : `${members.length.toLocaleString()} people`}
      </span>
    </div>
  );
}

/**
 * Function to render a column header that sorts by its column: ascending, then descending, then off.
 * @param props.column The column it sorts.
 * @param props.label The header text.
 * @param props.tableQuery The current filters and sort.
 * @returns The header cell.
 */
function SortableHeader({ column, label, tableQuery }: { column: SortColumn; label: string; tableQuery: TableQuery }) {
  const direction = tableQuery.sort?.column === column ? tableQuery.sort.direction : null;
  const nextSort: TableQuery["sort"] =
    direction === null ? { column, direction: "asc" } : direction === "asc" ? { column, direction: "desc" } : null;
  return (
    <th scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}>
      <button
        type="button"
        className="sort-button"
        data-direction={direction ?? undefined}
        onClick={() => setTableQuery({ ...tableQuery, sort: nextSort })}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 10 4-4 4 4" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      </button>
    </th>
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
 * Function to render the team table: a toolbar to filter it, a sticky header that sorts it, and only
 * the rows in view. Each `<tr>`
 * carries `data-member-id`, the stable key used to resolve refs. Rows a previewed recipe would
 * change carry `data-preview`.
 * @returns The table.
 */
function TeamTable() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const virtualItems = useSyncExternalStore(tableVirtualizer.subscribe, tableVirtualizer.items);
  // Re-render on every settings change, so previews follow the values.
  useSyncExternalStore(subscribeSettings, readSettingsVersion);
  const previewedRecipe = usePreviewedRecipe();
  const tableQuery = useSyncExternalStore(subscribeTableQuery, readTableQuery);
  const visibleMembers = readVisibleMembers();

  // A hot reload of the virtualizer's module brings a new instance, which needs connecting too.
  useEffect(() => tableVirtualizer.connect(scrollerRef.current!), [tableVirtualizer]);

  return (
    <>
      <TableToolbar tableQuery={tableQuery} visibleCount={visibleMembers.length} />
      <div className="table-wrap" data-team-table ref={scrollerRef}>
        <table className="team-table" aria-rowcount={visibleMembers.length + 1}>
          <thead>
            <tr aria-rowindex={1}>
              <SortableHeader column="name" label="Name" tableQuery={tableQuery} />
              <SortableHeader column="team" label="Team" tableQuery={tableQuery} />
              <SortableHeader column="title" label="Title" tableQuery={tableQuery} />
              <SortableHeader column="location" label="Location" tableQuery={tableQuery} />
              <th scope="col">{fields.role.label}</th>
              <th scope="col">{fields.seat.label}</th>
              <th scope="col">{fields.deployAlerts.label}</th>
              <th scope="col">{fields.weeklyDigest.label}</th>
            </tr>
          </thead>
          <tbody style={{ height: tableVirtualizer.size() }}>
            {virtualItems.map((item) => {
              const member = visibleMembers[item.index]!;
              const settings = readSettings(member.id);
              const isPreviewed = previewedRecipe !== null && matches(previewedRecipe, member, settings);
              return (
                <MemberRow
                  key={item.key}
                  member={member}
                  index={item.index}
                  start={item.start}
                  previewChanges={isPreviewed ? changesFor(previewedRecipe, member, settings) : []}
                />
              );
            })}
          </tbody>
        </table>
        {visibleMembers.length === 0 && <p className="table-empty muted">No one matches these filters.</p>}
      </div>
    </>
  );
}

export { TeamTable };
