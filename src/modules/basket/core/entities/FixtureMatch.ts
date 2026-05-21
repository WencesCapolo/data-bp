export interface FixtureMatchProps {
  id: number;
  matchDate: Date | null;
  matchTime: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  venue: string | null;
  broadcaster: string | null;
  sourceSheet: string;
}

export class FixtureMatch {
  constructor(private readonly props: FixtureMatchProps) {}
  get id(): number { return this.props.id; }
  toJSON(): FixtureMatchProps { return { ...this.props }; }
  static fromProps(props: FixtureMatchProps): FixtureMatch { return new FixtureMatch(props); }
}
