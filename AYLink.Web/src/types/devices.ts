export interface DeviceGroupSummary {
  Id: number;
  Name: string;
  Source?: string | null;
}

export interface DeviceSummary {
  Id: number;
  Name?: string | null;
  Serial?: string | null;
  IpAddress?: string | null;
  Port?: number | null;
  Status?: string | null;
  Groups?: DeviceGroupSummary[] | null;
  GroupSources?: string[] | null;
}
