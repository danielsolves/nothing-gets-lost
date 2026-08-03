// services/mailer/src/mail.controller.ts
// HTTP surface of the mailer: one endpoint that sends the confirmation mail for an
// event. It answers with the stored record on a repeat, so a retrying mediator learns
// the mail is already out instead of sending a second one.
import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { MailService } from './mail.service';

export const MAIL_SERVICE = Symbol('MAIL_SERVICE');

export interface SendMailRequest {
  eventId: string;
  recipient: string;
  subject: string;
  body: string;
}

@Controller()
export class MailController {
  constructor(@Inject(MAIL_SERVICE) private readonly mail: MailService) {}

  @Post('send')
  async send(
    @Body() request: SendMailRequest,
  ): Promise<{ messageId: string | null; sentAt: string; alreadySent: boolean }> {
    const result = await this.mail.send(
      request.eventId, request.recipient, request.subject, request.body,
    );
    return {
      messageId: result.messageId,
      sentAt: result.sentAt.toISOString(),
      alreadySent: result.alreadySent,
    };
  }
}
