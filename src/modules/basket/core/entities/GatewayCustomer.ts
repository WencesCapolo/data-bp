/**
 * A gateway customer — the bridge between a Provider object and a Subscriber.
 *
 * A subscription carries a customer id and nothing else identifying; a dispute
 * carries a charge. Neither carries an email, and email is the only field our
 * own Subscriber table shares with the Provider. Without this mirror, "which
 * Subscriber cancelled" cannot be answered from Provider data at all.
 */
export interface GatewayCustomerProps {
  platform: number;
  customerId: string;
  email: string | null;
  name: string | null;
  /** From the customer's stored address. NOT where a Pago was made. */
  country: string | null;
  currency: string | null;
  delinquent: boolean | null;
  description: string | null;
  createdAt: Date | null;
}

export class GatewayCustomer {
  constructor(private readonly props: GatewayCustomerProps) {}

  get customerId(): string { return this.props.customerId; }

  /** Lower-cased, because that is the only form a join to a Subscriber can use:
   *  the Provider stores whatever the Subscriber typed. */
  get emailKey(): string | null {
    return this.props.email?.trim().toLowerCase() || null;
  }

  toJSON(): GatewayCustomerProps {
    return { ...this.props };
  }

  static fromProps(props: GatewayCustomerProps): GatewayCustomer {
    return new GatewayCustomer(props);
  }
}
