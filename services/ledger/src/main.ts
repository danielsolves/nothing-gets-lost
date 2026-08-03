// services/ledger/src/main.ts
// The ledger is the one target where "off" means off: it closes its listening
// socket, so the mediator gets a real connection refused rather than a simulated
// error. Everything else is cut at the egress gate instead (spec 7).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, Controller, Post } from '@nestjs/common';
import { getPool } from '@ngl/db';
import { InvoiceController, INVOICE_SERVICE } from './invoice.controller';
import { InvoiceService } from './invoice.service';

let httpServer: import('node:http').Server | undefined;

@Controller('internal')
class ListenController {
  @Post('close')
  close(): { listening: boolean } {
    httpServer?.close();
    return { listening: false };
  }

  @Post('listen')
  listen(): { listening: boolean } {
    httpServer?.listen(3004, '0.0.0.0');
    return { listening: true };
  }
}

@Module({
  controllers: [InvoiceController, ListenController],
  providers: [{ provide: INVOICE_SERVICE, useFactory: () => new InvoiceService(getPool()) }],
})
class LedgerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(LedgerModule);
  await app.listen(3004, '0.0.0.0');
  httpServer = app.getHttpServer();
}
void bootstrap();
