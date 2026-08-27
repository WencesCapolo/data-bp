import nodemailer, { type Transporter } from 'nodemailer';

// SMTP config is the same Google Workspace sender the portal uses: an app
// password on a dedicated mailbox, STARTTLS on 587. Copied from basketProd's
// src/lib/email/mailer.ts deliberately — one sender, one app password to rotate.
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function readSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const host = env.SMTP_HOST ?? 'smtp.gmail.com';
  const port = Number(env.SMTP_PORT ?? '587');
  const user = env.SMTP_USER ?? '';
  const pass = env.SMTP_PASS ?? '';
  if (!host || !user || !pass) {
    throw new Error('Missing SMTP environment variables. Set SMTP_HOST, SMTP_USER and SMTP_PASS.');
  }
  return { host, port, user, pass, from: env.MAIL_FROM ?? user };
}

let cached: Transporter | undefined;

export function getTransport(config: SmtpConfig): Transporter {
  cached ??= nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: false, // STARTTLS on 587
    auth: { user: config.user, pass: config.pass },
  });
  return cached;
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  config?: SmtpConfig;
}): Promise<void> {
  const config = input.config ?? readSmtpConfig();
  await getTransport(config).sendMail({
    from: config.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
}
