/** Outgoing citizen notifications. The domain only knows this interface; SMTP lives in src/infra (keeps nodemailer out of the domain). */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Notifier {
  /** true when messages really leave the system (shown in /health) */
  readonly enabled: boolean;
  send(mail: Mail): Promise<void>;
}

/** Default when SMTP is not configured: nothing is sent. */
export class NullNotifier implements Notifier {
  readonly enabled = false;
  async send(): Promise<void> {}
}

/** Tests: keeps what would have been sent. */
export class MemoryNotifier implements Notifier {
  readonly enabled = true;
  readonly sent: Mail[] = [];
  failNext = false;
  async send(mail: Mail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('smtp down');
    }
    this.sent.push(mail);
  }
}
