import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { buildApp } from './app.factory';
import { loadConfig } from './domain';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  if (config.nodeEnv === 'production' && !config.staffKey && config.staffUsers.length === 0) {
    throw new Error('STAFF_API_KEY o STAFF_USERS es obligatoria en producción: sin ella cualquiera podría leer los datos personales de la bandeja.');
  }
  const app = await buildApp(config);
  await app.listen(config.port, '0.0.0.0');
  const log = new Logger('Bootstrap');
  log.log(`API:     http://localhost:${config.port}/api/v1`);
  log.log(`Swagger: http://localhost:${config.port}/docs`);
  log.log(`IA:      ${config.aiUrl}  ·  datos: ${config.dataDir}  ·  funcionarios: ${config.staffUsers.length ? `${config.staffUsers.length} cuentas` : ''}${config.staffKey ? `${config.staffUsers.length ? ' + ' : ''}clave compartida` : ''}${config.staffKey || config.staffUsers.length ? '' : 'SIN CLAVE (solo desarrollo)'}`);
}

void bootstrap();
