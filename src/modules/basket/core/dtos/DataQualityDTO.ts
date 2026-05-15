export interface QualityIssue {
  code: string;       // e.g. 'payment_no_user', 'user_no_country'
  description: string;
  count: number;
}

export interface DataQualityDTO {
  generatedAt: string;
  issues: QualityIssue[];
  totals: {
    users: number;
    payments: number;
    teams: number;
  };
}
