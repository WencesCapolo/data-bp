export interface TournamentProps {
  id: number;
  name: string;
  country: string | null;
}

export class Tournament {
  constructor(private readonly props: TournamentProps) {}

  get id(): number { return this.props.id; }
  get name(): string { return this.props.name; }
  get country(): string | null { return this.props.country; }

  toJSON(): TournamentProps {
    return { ...this.props };
  }

  static fromProps(props: TournamentProps): Tournament {
    return new Tournament(props);
  }
}
