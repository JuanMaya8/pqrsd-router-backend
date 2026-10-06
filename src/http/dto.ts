/** Classes used ONLY to document the API in Swagger. Real validation lives in src/domain/validation.ts. */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CHANNELS, PQRSD_TYPES, SUBTYPES, URGENCIES } from '../domain';

export class CitizenDoc {
  @ApiPropertyOptional({ example: 'Ana Pérez' }) name?: string;
  @ApiPropertyOptional({ example: 'ana@correo.co' }) email?: string;
  @ApiPropertyOptional({ example: '3001234567' }) phone?: string;
  @ApiPropertyOptional({ example: '52123456' }) documentId?: string;
}

export class TextDoc {
  @ApiProperty({ minLength: 10, maxLength: 10000, example: 'Hace tres semanas no llega el agua a mi barrio Santa Lucía y tengo un bebé.' }) text!: string;
}

export class CreatePqrsdDoc extends TextDoc {
  @ApiPropertyOptional({ enum: CHANNELS, default: 'web' }) channel?: string;
  @ApiPropertyOptional({ type: CitizenDoc }) citizen?: CitizenDoc;
  @ApiPropertyOptional({ description: 'true ignora «citizen»' }) anonymous?: boolean;
  @ApiProperty({ description: 'Debe ser true (Ley 1581 de 2012)' }) consent!: boolean;
}

export class ReclassifyDoc {
  @ApiPropertyOptional({ enum: PQRSD_TYPES }) type?: string;
  @ApiPropertyOptional({ enum: SUBTYPES }) subtype?: string;
  @ApiPropertyOptional({ example: 'servicios_publicos' }) dependency?: string;
  @ApiPropertyOptional({ enum: URGENCIES }) urgency?: string;
  @ApiPropertyOptional({ maxLength: 500 }) note?: string;
}

export class NoteDoc {
  @ApiPropertyOptional({ maxLength: 500 }) note?: string;
}

export class AnswerDoc {
  @ApiProperty({ minLength: 10, maxLength: 5000 }) response!: string;
}

export class ImportItemDoc extends TextDoc {
  @ApiPropertyOptional({ description: 'ISO 8601; por defecto, ahora' }) receivedAt?: string;
}

export class ImportDoc {
  @ApiProperty({ type: [ImportItemDoc], description: 'Máximo 5 000' }) items!: ImportItemDoc[];
  @ApiPropertyOptional({ default: true, description: 'Marca los casos como de demostración' }) isDemo?: boolean;
}

export class SeedDoc {
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 60 }) count?: number;
}
