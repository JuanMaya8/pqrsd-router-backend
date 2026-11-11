import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Mail, Notifier } from '../domain';

/** Sends citizen e-mails through any SMTP server (SMTP_URL). Failures are logged, never surfaced to the request. */
export class SmtpNotifier implements Notifier {
  readonly enabled = true;
  private readonly transport: Transporter;
  private readonly log = new Logger('Mail');

  constructor(url: string, private readonly from: string) {
    this.transport = createTransport(url);
  }

  async send(mail: Mail): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
    } catch (e) {
      // the address is personal data: log only the subject
      this.log.warn(`No se pudo enviar «${mail.subject}»: ${(e as Error).message}`);
      throw e;
    }
  }
}
