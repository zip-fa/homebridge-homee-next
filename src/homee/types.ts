export interface HomeeAttribute {
  id: number;
  node_id: number;
  instance: number;
  type: number;
  minimum: number;
  maximum: number;
  current_value: number;
  target_value: number;
  unit: string;
  step_value: number;
  editable: number;
  options?: { reverse_control_ui?: boolean; [key: string]: unknown };
}

export interface HomeeNode {
  id: number;
  name: string;
  profile: number;
  state: number;
  note?: string;
  attributes: HomeeAttribute[];
}

export interface HomeeGroup {
  id: number;
  name: string;
}

export interface HomeeRelationship {
  id: number;
  group_id: number;
  node_id: number;
}

export interface HomeeSettings {
  homee_name?: string;
  version?: string;
  uid?: string;
}
