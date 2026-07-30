// services/ledger/src/invoice.controller.ts
// HTTP surface of the ledger: create an invoice for an event, read one back by id.
// A repeated event answers 200 with the stored invoice instead of an error, so the
// mediator can retry a delivery it is unsure about.
import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { InvoiceService } from './invoice.service';

export const INVOICE_SERVICE = Symbol('INVOICE_SERVICE');

@Controller('invoices')
export class InvoiceController {
  constructor(@Inject(INVOICE_SERVICE) private readonly invoices: InvoiceService) {}

  @Post()
  async create(
    @Body() body: { eventId: string; totalCents: number },
    @Res() response: Response,
  ): Promise<void> {
    const invoice = await this.invoices.createOrGet(body.eventId, body.totalCents);
    response.status(invoice.created ? 201 : 200).json({
      id: invoice.id, number: invoice.number, createdAt: invoice.createdAt.toISOString(),
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const invoice = await this.invoices.findById(id);
    if (!invoice) { response.status(404).json({ error: 'not found' }); return; }
    response.json({
      id: invoice.id, number: invoice.number, createdAt: invoice.createdAt.toISOString(),
    });
  }
}
