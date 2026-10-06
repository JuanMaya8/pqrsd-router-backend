import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { PqrsdService } from '../domain';
import { AnswerDoc, ImportDoc, NoteDoc, ReclassifyDoc, SeedDoc } from '../http/dto';
import { StaffGuard } from '../http/staff.guard';
import { TOKENS } from '../tokens';

@ApiTags('funcionario')
@ApiSecurity('staff-key')
@UseGuards(StaffGuard)
@Controller('staff')
export class StaffController {
  constructor(@Inject(TOKENS.SERVICE) private readonly service: PqrsdService) {}

  @Get('pqrsd')
  @ApiOperation({ summary: 'Bandeja: filtros status, type, dependency, urgency, sla, needsReview, q, isDemo; sort; limit; offset' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list(query);
  }

  @Get('pqrsd/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Detalle con texto, ciudadano, entidades, justificaciones de la IA y línea de tiempo' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('pqrsd/:id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acepta la clasificación de la IA' })
  confirm(@Param('id') id: string, @Body() body: NoteDoc) {
    return this.service.confirm(id, body);
  }

  @Post('pqrsd/:id/reclassify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Corrige tipo, subtipo, dependencia o urgencia (alimenta a la IA)' })
  reclassify(@Param('id') id: string, @Body() body: ReclassifyDoc) {
    return this.service.reclassify(id, body);
  }

  @Post('pqrsd/:id/answer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registra la respuesta al ciudadano' })
  answer(@Param('id') id: string, @Body() body: AnswerDoc) {
    return this.service.answer(id, body);
  }

  @Post('pqrsd/:id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cierra una PQRSD respondida' })
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Get('stats')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Indicadores de la bandeja' })
  stats() {
    return this.service.stats();
  }

  @Get('export.csv')
  @ApiOperation({ summary: 'CSV (sin texto ni datos personales) con los mismos filtros de la bandeja' })
  async exportCsv(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: { setHeader(k: string, v: string): void }): Promise<string> {
    const csv = await this.service.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pqrsd.csv"');
    return csv;
  }

  @Post('import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Importa hasta 5 000 textos (pruebas de volumen, p. ej. issues de GitHub)' })
  importMany(@Body() body: ImportDoc) {
    return this.service.importMany(body);
  }

  @Post('demo/seed')
  @HttpCode(200)
  @ApiOperation({ summary: 'Crea casos de demostración (isDemo = true)' })
  seed(@Body() body: SeedDoc) {
    return this.service.seedDemo(body);
  }

  @Delete('demo')
  @ApiOperation({ summary: 'Borra solo los casos de demostración' })
  deleteDemo() {
    return this.service.deleteDemo();
  }

  @Get('ai/status')
  @ApiOperation({ summary: 'Estado de la IA y de la retroalimentación acumulada' })
  aiStatus() {
    return this.service.aiStatus();
  }

  @Post('ai/retrain')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reentrena la IA con la retroalimentación acumulada' })
  retrain() {
    return this.service.retrainAi();
  }
}
