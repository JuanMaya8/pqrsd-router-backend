import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AppConfig, PqrsdService } from '../domain';
import { CreatePqrsdDoc, TextDoc } from '../http/dto';
import { PublicWriteGuard } from '../http/public-write.guard';
import { TOKENS } from '../tokens';

@ApiTags('ciudadano')
@Controller()
export class PublicController {
  constructor(@Inject(TOKENS.SERVICE) private readonly service: PqrsdService, @Inject(TOKENS.CONFIG) private readonly config: AppConfig) {}

  @Get('health')
  @ApiTags('system')
  @ApiOperation({ summary: 'Estado del backend y de la IA' })
  async health() {
    const ai = await this.service.health();
    return { status: 'ok' as const, version: this.config.version, ai, store: 'file' as const };
  }

  @Post('pqrsd/preview')
  @HttpCode(200)
  @UseGuards(PublicWriteGuard)
  @ApiOperation({ summary: 'Vista previa de la clasificación mientras el ciudadano escribe (no guarda nada)' })
  preview(@Body() body: TextDoc) {
    return this.service.preview(body);
  }

  @Post('pqrsd')
  @UseGuards(PublicWriteGuard)
  @ApiOperation({ summary: 'Radica una PQRSD: clasifica, calcula el plazo legal y devuelve radicado y código de seguimiento' })
  create(@Body() body: CreatePqrsdDoc) {
    return this.service.create(body);
  }

  @Get('public/tracking/:radicado')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Estado público de una solicitud (requiere el código de seguimiento)' })
  @ApiQuery({ name: 'code', required: true })
  tracking(@Param('radicado') radicado: string, @Query('code') code?: string) {
    return this.service.tracking(radicado, typeof code === 'string' ? code : undefined);
  }

  @Get('public/transparency')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'Indicadores agregados y públicos, sin datos personales' })
  transparency() {
    return this.service.transparency();
  }

  @Get('meta/taxonomy')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Tipos, urgencias, subtipos y dependencias' })
  taxonomy() {
    return this.service.taxonomy();
  }
}
