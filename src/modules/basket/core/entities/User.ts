export interface UserProps {
  id: number;
  idx: string | null;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  createdAt: Date;
  loginAt: Date | null;
  status: number;
  lastStatus: number | null;
  promoTeamId: number | null;
  promoTeamChangedAt: Date | null;
  playToken: number | null;
  roles: number | null;
  country: string | null;
  emailVerified: boolean;
}

export class User {
  constructor(private readonly props: UserProps) {}

  get id(): number { return this.props.id; }
  get email(): string | null { return this.props.email; }
  get country(): string | null { return this.props.country; }
  get promoTeamId(): number | null { return this.props.promoTeamId; }
  get createdAt(): Date { return this.props.createdAt; }
  get isRegistered(): boolean { return this.props.status === 1; }
  get isEmailVerified(): boolean { return this.props.emailVerified; }

  toJSON(): UserProps {
    return { ...this.props };
  }

  static fromProps(props: UserProps): User {
    return new User(props);
  }
}
