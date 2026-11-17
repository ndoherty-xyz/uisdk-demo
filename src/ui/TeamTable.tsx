import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { fields, type SelectFieldId } from "../data/fields";
import { initialSettings, members } from "../data/members";

// Controls ----------

/**
 * Function to render one select setting with a visually hidden generic label ("Role"), so the
 * bridge labels every row's control the same and the row tells them apart.
 * @param props.fieldId Which select field this is.
 * @param props.defaultValue The seed value.
 * @returns The select.
 */
function SettingSelect({ fieldId, defaultValue }: { fieldId: SelectFieldId; defaultValue: string }) {
  const field = fields[fieldId];
  const items = field.options.map(([value, label]) => ({ value, label }));
  return (
    <Select defaultValue={defaultValue} items={items}>
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
 * Function to render one on/off setting, named by its generic field label.
 * @param props.label The field label, e.g. "Deploy alerts".
 * @param props.defaultChecked The seed value.
 * @returns The switch.
 */
function SettingSwitch({ label, defaultChecked }: { label: string; defaultChecked: boolean }) {
  return (
    <Switch aria-label={label} defaultChecked={defaultChecked} className="switch">
      <SwitchThumb className="switch-thumb" />
    </Switch>
  );
}

// Table ----------

/**
 * Function to render the team table: static member details plus four uncontrolled settings per
 * row. Each `<tr>` carries `data-member-id`, the stable key used to resolve refs.
 * @returns The table.
 */
function TeamTable() {
  return (
    <div className="table-wrap" data-team-table>
      <table className="team-table">
        <thead>
          <tr>
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
        <tbody>
          {members.map((member) => {
            const settings = initialSettings[member.id]!;
            return (
              <tr key={member.id} data-member-id={member.id}>
                <th scope="row" className="name-cell">
                  {member.name}
                </th>
                <td>{member.team}</td>
                <td className="muted">{member.title}</td>
                <td className="muted">{member.location}</td>
                <td>
                  <SettingSelect fieldId="role" defaultValue={settings.role} />
                </td>
                <td>
                  <SettingSelect fieldId="seat" defaultValue={settings.seat} />
                </td>
                <td>
                  <SettingSwitch label={fields.deployAlerts.label} defaultChecked={settings.deployAlerts} />
                </td>
                <td>
                  <SettingSwitch label={fields.weeklyDigest.label} defaultChecked={settings.weeklyDigest} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { TeamTable };
