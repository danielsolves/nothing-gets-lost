// services/mailer/src/main.ts
// Entry point of the mailer: binds the service to a real SMTP transport and listens
// on 3005. The mail is the second witness of the proof chain, so the transport is a
// real provider rather than a stub — a fake send would prove nothing.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { getPool } from '@ngl/db';
import { MailController, MAIL_SERVICE } from './mail.controller';
import { MailService, type Transport } from './mail.service';

function smtpTransport(url: string): Transport {
  const mailer = createTransport(url);
  return {
    async send(message) {
      const info = await mailer.sendMail(message);
      return { messageId: info.messageId };
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

@Module({
  controllers: [MailController],
  providers: [{
    provide: MAIL_SERVICE,
    useFactory: () => new MailService(
      getPool(), smtpTransport(requireEnv('SMTP_URL')), requireEnv('MAIL_FROM'),
    ),
  }],
})
class MailerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(MailerModule);
  await app.listen(3005, '0.0.0.0');
}
void bootstrap();
