/**
 * Demo cases (clearly flagged `isDemo`). Texts are invented, written in the register real citizens use.
 * They are NOT a training set and NOT an accuracy benchmark.
 */
export const DEMO_TEXTS: string[] = [
  'Buenas tardes, llevo tres semanas esperando que arreglen el hueco que hay frente a mi casa en la calle {n} con carrera {m}, ya se me dañó una llanta y pueden ocurrir accidentes.',
  'Solicito respetuosamente copia del contrato de obra número {n} de 2024 celebrado para la construcción del parque del barrio {b}.',
  'Hace una semana no llega el agua a mi barrio {b} y tengo un bebé de meses, necesito que la empresa de acueducto atienda esto ya.',
  'Quiero poner una queja contra el funcionario de la ventanilla {k} que me trató muy mal y se rió cuando le pregunté por mi trámite.',
  'Me gustaría proponer que instalen más canecas de reciclaje en el parque principal del barrio {b}, hay mucha basura los fines de semana.',
  'Denuncio que un funcionario de la oficina de tránsito me pidió {n}0 mil pesos para agilizar el trámite de mi licencia.',
  'Mi papá tiene 80 años y lleva dos meses esperando una cita con el especialista en cardiología, la EPS dice que la secretaría no ha autorizado.',
  'Por favor me informan cuál es el procedimiento y los requisitos para solicitar una licencia de construcción para una casa de dos pisos en el barrio {b}.',
  'Pagué el impuesto predial en enero y todavía me aparece como deudor, necesito el paz y salvo urgente porque tengo escritura el viernes.',
  'Hay un árbol enorme a punto de caerse sobre la vivienda de mi vecina en la carrera {k} con {n}, está inclinado y con las lluvias puede caer en cualquier momento.',
  'Quisiera sugerir una ciclorruta en la avenida principal, sería de gran ayuda para los estudiantes del colegio del barrio {b}.',
  'El semáforo de la esquina de la {n} con {k} lleva días dañado y casi atropellan a un niño ayer, por favor envíen a alguien.',
  'Solicito se me informe el estado de mi solicitud de subsidio de arriendo radicada hace dos meses, nadie me da razón.',
  'Mi hijo no ha podido ser matriculado en ningún colegio público del sector y las clases ya empezaron, necesito un cupo.',
  'En el barrio {b} hay venta de drogas todas las noches en la esquina del parque y la policía no hace nada, tengo miedo por mis hijos.',
  'Agradezco que me expliquen cómo puedo pagar el impuesto de vehículos en cuotas porque no cuento con todo el dinero.',
  'Una fuga de gas en el edificio de la calle {n} #{k}-20 huele muy fuerte desde esta mañana, la gente está asustada.',
  'La atención en el punto de atención al ciudadano es pésima, hacen fila por horas y los funcionarios solo hablan por celular.',
  'Pido que me certifiquen que mi predio no está en zona de riesgo, lo necesito para un crédito de vivienda.',
  'Quiero denunciar que la constructora vecina está botando escombros al río y contaminando el agua, ya hay peces muertos.',
  'Mi factura de agua llegó por $1.850.000 cuando normalmente pago 60 mil, es un error evidente y solicito revisión.',
  'Deseo saber cuáles son los horarios y los documentos para inscribirme en el programa de adulto mayor.',
  'Nos tienen sin ambulancia en el centro de salud de la vereda desde hace un mes, una señora casi muere ayer esperando traslado.',
  'Me multaron por un comparendo que no es mío, la placa que aparece es ABC123 y mi carro es otro. Pido que lo anulen.',
  'Señores, el ruido de un bar en el barrio {b} no nos deja dormir, ya van seis meses y nadie viene a controlar el volumen.',
  'Propongo que se habilite una app para pedir citas en los centros de salud y así evitar las filas desde las 4 de la mañana.',
  'Denuncio posible nepotismo: la secretaria contrató a su hermano sin concurso y sin cumplir los requisitos del cargo.',
  'Hay un cable de alta tensión caído frente al colegio del barrio {b} y hay niños cerca, es una emergencia.',
  'Solicito una consulta: ¿es viable construir un segundo piso en un lote de {n}0 metros según el plan de ordenamiento?',
  'El recolector de basuras no pasa por la calle {n} hace diez días y ya hay ratas, por favor solucionen.',
];

export const BARRIOS = ['Santa Lucía', 'La Floresta', 'El Prado', 'San Fernando', 'Villa Hermosa', 'Los Pinos', 'Altos del Parque', 'La Esperanza'];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoText(rng: () => number): string {
  const tpl = DEMO_TEXTS[Math.floor(rng() * DEMO_TEXTS.length)];
  const int = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
  return tpl
    .replace(/\{n\}/g, () => String(int(2, 98)))
    .replace(/\{m\}/g, () => String(int(1, 40)))
    .replace(/\{k\}/g, () => String(int(1, 30)))
    .replace(/\{b\}/g, () => BARRIOS[Math.floor(rng() * BARRIOS.length)]);
}
