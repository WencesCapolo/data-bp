export interface TeamProps {
  id: number;
  teamName: string;
  league: string;
  country: string;
  tier: number;
  type: string;
}

export class Team {
  constructor(private readonly props: TeamProps) {}

  get id(): number { return this.props.id; }
  get name(): string { return this.props.teamName; }
  get league(): string { return this.props.league; }
  get country(): string { return this.props.country; }
  get tier(): number { return this.props.tier; }
  get type(): string { return this.props.type; }
  get isFormativa(): boolean { return this.props.type === 'formativa'; }

  toJSON(): TeamProps {
    return { ...this.props };
  }

  static fromProps(props: TeamProps): Team {
    return new Team(props);
  }
}
