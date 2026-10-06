import type { Status, TaxonomyDto } from './types';

/** Built-in taxonomy, used when the AI service is down (mirrors pqrsd-router-ai `taxonomy.py`). The AI's own taxonomy wins when reachable. */
export const DEFAULT_TAXONOMY: TaxonomyDto = {
  types: [
    { id: 'peticion', label: 'Petición', description: 'Solicitud respetuosa de información, documentos, un trámite o una actuación de la entidad.' },
    { id: 'queja', label: 'Queja', description: 'Inconformidad con la conducta o actuación de un servidor público.' },
    { id: 'reclamo', label: 'Reclamo', description: 'Inconformidad por un servicio no prestado o prestado de forma deficiente; se exige solución.' },
    { id: 'sugerencia', label: 'Sugerencia', description: 'Propuesta para mejorar un servicio, trámite o política de la entidad.' },
    { id: 'denuncia', label: 'Denuncia', description: 'Pone en conocimiento hechos presuntamente irregulares, corruptos o delictivos.' },
  ],
  urgency: [
    { id: 'critical', label: 'Crítica', description: 'Riesgo inminente para la vida, la integridad o la seguridad de personas.' },
    { id: 'high', label: 'Alta', description: 'Derechos fundamentales, población vulnerable o plazos vencidos.' },
    { id: 'medium', label: 'Media', description: 'Trámite o inconformidad ordinaria.' },
    { id: 'low', label: 'Baja', description: 'Sugerencias o solicitudes sin afectación actual.' },
  ],
  subtypes: [
    { id: 'general', label: 'Petición general', description: 'Solicitud general (15 días hábiles).' },
    { id: 'information', label: 'Solicitud de información o documentos', description: 'Copias, certificaciones o acceso a información (10 días hábiles).' },
    { id: 'consultation', label: 'Consulta', description: 'Consulta a la autoridad sobre asuntos a su cargo (30 días hábiles).' },
  ],
  dependencies: [
    { id: 'atencion_ciudadano', name: 'Atención al Ciudadano', description: 'Orientación general, radicación y asuntos sin dependencia clara.' },
    { id: 'salud', name: 'Secretaría de Salud', description: 'Servicios de salud, EPS/IPS, vacunación y salud pública.' },
    { id: 'movilidad', name: 'Secretaría de Movilidad y Tránsito', description: 'Tránsito, transporte público, comparendos y licencias.' },
    { id: 'hacienda', name: 'Secretaría de Hacienda e Impuestos', description: 'Impuestos, facturación, pagos y cobro coactivo.' },
    { id: 'infraestructura', name: 'Obras Públicas e Infraestructura', description: 'Vías, andenes, puentes, alumbrado y obras.' },
    { id: 'educacion', name: 'Secretaría de Educación', description: 'Colegios públicos, cupos, docentes, alimentación y transporte escolar.' },
    { id: 'ambiente', name: 'Secretaría de Ambiente', description: 'Contaminación, árboles, fauna, ríos y quemas.' },
    { id: 'planeacion', name: 'Planeación y Urbanismo', description: 'Licencias de construcción, uso del suelo, estratificación y espacio público.' },
    { id: 'servicios_publicos', name: 'Servicios Públicos Domiciliarios', description: 'Agua, alcantarillado, energía, gas y aseo.' },
    { id: 'seguridad', name: 'Seguridad y Convivencia', description: 'Policía, inseguridad, convivencia y ruido.' },
    { id: 'control_interno', name: 'Control Interno Disciplinario', description: 'Conducta de servidores públicos y presunta corrupción.' },
    { id: 'desarrollo_social', name: 'Desarrollo Social', description: 'Subsidios, adulto mayor, víctimas, discapacidad y familias.' },
  ],
  fallbackDependency: 'atencion_ciudadano',
};

export const STATUS_LABELS: Record<Status, string> = {
  pending_review: 'Recibida, en revisión',
  assigned: 'Asignada a la dependencia',
  answered: 'Respondida',
  closed: 'Cerrada',
};

export const SLA_LABELS: Record<string, string> = {
  on_time: 'En términos',
  at_risk: 'En riesgo de vencer',
  overdue: 'Vencida',
  done: 'Respondida',
};

/** Event labels shown to the citizen on the public tracking page (no internal detail). */
export const PUBLIC_EVENT_LABELS: Record<string, string> = {
  received: 'Recibimos tu solicitud',
  classified: 'La solicitud fue clasificada y enviada a la dependencia',
  confirmed: 'Un funcionario revisó y asignó tu solicitud',
  reclassified: 'Un funcionario revisó y reasignó tu solicitud',
  answered: 'La entidad respondió tu solicitud',
  closed: 'La solicitud fue cerrada',
};

export function labelOf(list: Array<{ id: string; label: string }>, id: string): string {
  return list.find((o) => o.id === id)?.label ?? id;
}

export function depName(tax: TaxonomyDto, id: string): string {
  return tax.dependencies.find((d) => d.id === id)?.name ?? id;
}
