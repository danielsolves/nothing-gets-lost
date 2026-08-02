// services/extractor/src/main.ts
// Boots the extractor. The model client is built once here and may be null —
// without a key the service runs on recorded answers, because a demo that fails
// to start for a stranger who just cloned it proves the opposite of its point
// (spec 8.5).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { getPool } from '@ngl/db';
import { ExtractController, EXTRACT_SERVICE } from './extract.controller';
import { ExtractService } from './extract.service';
import { createModel } from './openai.model';

@Module({
  controllers: [ExtractController],
  providers: [{
    provide: EXTRACT_SERVICE,
    useFactory: () => new ExtractService(getPool(), createModel(process.env.OPENAI_API_KEY)),
  }],
})
class ExtractorModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ExtractorModule);
  await app.listen(3006, '0.0.0.0');
}
void bootstrap();
