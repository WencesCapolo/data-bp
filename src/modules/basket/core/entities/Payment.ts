import { AccessType, classifyAccessType } from '../value-objects/AccessType';
import { SubType, classifySubType } from '../value-objects/SubType';
import { platformName } from '../value-objects/Platform';

export interface PaymentProps {
  id: number;
  userId: number;
  paymentEmail: string | null;
  platformPaymentId: string | null;
  platform: number;
  productId: number | null;
  priceId: number | null;
  contentId: number | null;
  amount: number;
  currency: string | null;
  recurrent: number;
  expiresAt: Date;
  createdAt: Date;
  status: number;
  statusDetail: string | null;
  keycode: string | null;
  paymentCountry: string | null;
}

export class Payment {
  static readonly GRACE_PERIOD_DAYS = 7;
  private static readonly EPOCH_SENTINEL_MS = 0;

  constructor(private readonly props: PaymentProps) {}

  get id(): number { return this.props.id; }
  get userId(): number { return this.props.userId; }
  get amount(): number { return this.props.amount; }
  get currency(): string | null { return this.props.currency; }
  get recurrent(): number { return this.props.recurrent; }
  get expiresAt(): Date { return this.props.expiresAt; }
  get createdAt(): Date { return this.props.createdAt; }
  get status(): number { return this.props.status; }
  get paymentCountry(): string | null { return this.props.paymentCountry; }

  get subType(): SubType {
    return classifySubType(this.props.recurrent, this.props.priceId);
  }

  get accessType(): AccessType {
    return classifyAccessType(this.props.platform, this.props.amount);
  }

  get platformName(): string {
    return platformName(this.props.platform);
  }

  get hasNoExpiry(): boolean {
    return this.props.expiresAt.getTime() <= Payment.EPOCH_SENTINEL_MS;
  }

  isActiveOn(date: Date): boolean {
    if (this.props.status !== 1) return false;
    if (this.hasNoExpiry) return this.props.recurrent === 0;
    const expiryWithGrace = new Date(this.props.expiresAt);
    expiryWithGrace.setDate(expiryWithGrace.getDate() + Payment.GRACE_PERIOD_DAYS);
    return this.props.createdAt <= date && expiryWithGrace >= date;
  }

  isCurrentlyActive(now: Date = new Date()): boolean {
    return this.isActiveOn(now);
  }

  toJSON(): PaymentProps {
    return { ...this.props };
  }

  static fromProps(props: PaymentProps): Payment {
    return new Payment(props);
  }
}
