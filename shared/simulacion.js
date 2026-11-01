// Simulación de caja: el mismo cálculo en el servidor y en la pantalla (para que los controles respondan al momento).
// Todo con IVA, como el banco. Arranca el mes siguiente al último mes real cerrado, con su saldo.

export function sumarMeses(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// ¿Se aplica un ajuste en un mes? puntual: solo ese mes; mensual: desde ese mes (y hasta «hasta», si lo tiene)
export function ajusteActivo(a, mes) {
  if (a.desactivado) return false;
  if (a.tipo === 'mensual') return mes >= a.desde && (!a.hasta || mes <= a.hasta);
  return mes === a.desde;
}

// Locales que empiezan a pagar cuota en el mes k: los vendidos d = semanas/4,345 meses antes.
// Con d = n + f, de las ventas de cada mes una parte (1 − f) arranca n meses después y el resto (f), n + 1 meses después.
function empiezanAPagar(k, vendidos, ritmoAntes, semanas) {
  const d = Math.max(0, semanas) / 4.345;
  const n = Math.floor(d), f = d - n;
  const ventas = (j) => (j < 0 ? ritmoAntes : vendidos);
  return ventas(k - n) * (1 - f) + ventas(k - n - 1) * f;
}

// Socios: «coste» es la base de la factura o el bruto de la nómina, sin IVA: lo que de verdad cuesta a la empresa.
// Por factura (autónomo) se le paga además el IVA, que se recupera en el trimestre, y se le retiene el IRPF;
// por nómina no hay IVA, se retiene el IRPF y, si la empresa paga su cuota de autónomo, se suma al coste.
// El IRPF retenido se ingresa a Hacienda cada trimestre (modelo 111).
export const IVA_FACTURA_SOCIO = 21;
export const IRPF_POR_DEFECTO = { factura: 7, nomina: 19 };
export function pagoSocio(so) {
  const nomina = so.modalidad === 'nomina';
  const coste = Number(so.coste) || 0;
  const irpf = Number(so.irpf ?? IRPF_POR_DEFECTO[nomina ? 'nomina' : 'factura']) || 0;
  const cuota = nomina ? Number(so.cuota) || 0 : 0;
  const iva = nomina ? 0 : (coste * IVA_FACTURA_SOCIO) / 100;
  const retencion = (coste * irpf) / 100;
  const alSocio = coste + iva - retencion;
  return { coste, iva, retencion, cuota, alSocio, banco: alSocio + cuota, costeReal: coste + cuota };
}
export const socioActivo = (so, mes) => !so.desactivado && (!so.desde || mes >= so.desde) && (!so.hasta || mes <= so.hasta);

/**
 * @param s    supuestos: { restaurantes, nuevosMes (vendidos al mes), semanas (de la venta a la puesta en marcha), bajasMes, ticketMedio, precioPuestaMarcha,
 *             gastos[] (sin socios, sin IVA), horizonte, incluirHacienda, ajustes[], socios[] }
 *             gasto: { id, grupo, subgrupo, coste (€/mes sin IVA), iva, irpf, desactivado? } — sin gastos[], el gastoMensual antiguo (con IVA)
 *             ajuste: { id, concepto, efecto: 'gasto' | 'ingreso', importe (sin IVA), tipo: 'puntual' | 'mensual', desde, hasta? }
 *             socio: { id, nombre, modalidad: 'factura' | 'nomina', coste, irpf?, cuota?, desde?, hasta?, desactivado? }
 * @param base datos reales: { mesInicio, cajaInicial, tipos: { ivaVentas, ivaGastos, irpfGastos },
 *             ivaMesesReales: { 'YYYY-MM': { rep, sop, ret } }, pagosPendientes: { 'YYYY-MM': importe }, compensarIva }
 */
export function simular(s, base) {
  const { ivaVentas, ivaGastos, irpfGastos } = base.tipos;
  const conIvaVentas = (x) => x * (1 + ivaVentas / 100);
  const divGastos = 100 + ivaGastos - irpfGastos;
  const ajustes = s.ajustes || [];
  // Gasto por categorías, sin IVA: cada una con su IVA y su IRPF reales (son los que pasan por la caja y por Hacienda)
  const partidasGasto = Array.isArray(s.gastos) ? s.gastos.filter((g) => !g.desactivado) : null;
  const fijo = (partidasGasto || []).reduce((t, g) => {
    const b = Number(g.coste) || 0;
    return { base: t.base + b, iva: t.iva + (b * (Number(g.iva) || 0)) / 100, irpf: t.irpf + (b * (Number(g.irpf) || 0)) / 100 };
  }, { base: 0, iva: 0, irpf: 0 });
  const filas = [];
  const ivaMes = { ...(base.ivaMesesReales || {}) };
  let compensar = base.compensarIva || 0;
  let restaurantes = Number(s.restaurantes) || 0;
  let caja = base.cajaInicial;

  for (let k = 0; k < (Number(s.horizonte) || 12); k++) {
    const mes = sumarMeses(base.mesInicio, k);
    // La puesta en marcha se cobra el mes de la venta; la cuota, desde que el local está en marcha
    // («semanas» después de la venta). Las ventas se reparten a lo largo del mes, así que con 3 semanas
    // de una venta de octubre una parte empieza a pagar en octubre y el resto en noviembre.
    // Las ventas de antes de la simulación van al ritmo real reciente (base.ritmoActual).
    const vendidos = Number(s.nuevosMes) || 0;
    const nuevos = empiezanAPagar(k, vendidos, Number(base.ritmoActual ?? vendidos), Number(s.semanas ?? 4));
    const pagando = restaurantes + nuevos;
    const cuotas = conIvaVentas(pagando * (Number(s.ticketMedio) || 0));
    const puestas = conIvaVentas(vendidos * (Number(s.precioPuestaMarcha) || 0));
    const activos = ajustes.filter((a) => ajusteActivo(a, mes));
    const ingresoExtra = activos.filter((a) => a.efecto === 'ingreso').reduce((x, a) => x + Number(a.importe || 0), 0);
    const gastoExtra = activos.filter((a) => a.efecto !== 'ingreso').reduce((x, a) => x + Number(a.importe || 0), 0);
    const ingresos = cuotas + puestas + ingresoExtra;
    // Gasto general (sin socios): base sin IVA, IVA soportado e IRPF retenido. Los ajustes van sin IVA, con los tipos medios
    let g;
    if (partidasGasto) {
      const base = Math.max(0, fijo.base + gastoExtra), extra = base - fijo.base;
      g = { base, iva: fijo.iva + (extra * ivaGastos) / 100, irpf: fijo.irpf + (extra * irpfGastos) / 100 };
    } else { // previsiones antiguas: un gasto mensual con IVA
      const banco = Math.max(0, (Number(s.gastoMensual) || 0) + gastoExtra);
      g = { base: (banco * 100) / divGastos, iva: (banco * ivaGastos) / divGastos, irpf: (banco * irpfGastos) / divGastos };
    }
    const generales = g.base + g.iva - g.irpf; // lo que sale del banco
    const socios = (s.socios || []).filter((so) => socioActivo(so, mes)).map(pagoSocio);
    const deSocios = (k) => socios.reduce((x, p) => x + p[k], 0);
    const gastos = generales + deSocios('banco');

    // IVA y retenciones que van dentro de los importes, para el pago trimestral a Hacienda
    ivaMes[mes] = {
      rep: ((cuotas + puestas) * ivaVentas) / (100 + ivaVentas),
      sop: g.iva + deSocios('iva'),
      ret: g.irpf + deSocios('retencion'),
    };
    // Margen sin IVA: lo que de verdad gana la empresa ese mes (el IVA solo pasa por la caja)
    const margen = (cuotas + puestas + ingresoExtra) / (1 + ivaVentas / 100) - g.base - deSocios('costeReal');
    let hacienda = Number(base.pagosPendientes?.[mes] || 0);
    if ([1, 4, 7, 10].includes(Number(mes.slice(5, 7)))) {
      const trimestre = [-3, -2, -1].map((d) => ivaMes[sumarMeses(mes, d)]).filter(Boolean);
      // Si el trimestre ya está cerrado y pendiente de pago, el importe viene en pagosPendientes
      if (!base.pagosPendientes?.[mes] && trimestre.length) {
        const q = trimestre.reduce((x, y) => x + y.rep - y.sop, 0) + compensar;
        compensar = Math.min(0, q);
        hacienda += Math.max(0, q) + trimestre.reduce((x, y) => x + y.ret, 0);
      }
    }
    if (!s.incluirHacienda) hacienda = 0;

    const resultado = ingresos - gastos;
    caja += resultado - hacienda;
    const bajas = Math.min(pagando, Number(s.bajasMes) || 0);
    filas.push({ mes, restaurantesInicio: pagando, vendidos, nuevos, bajas, cuotas, puestas, ingresoExtra, gastoExtra, ingresos, gastos, generales, costeGenerales: g.base,
      socios: deSocios('banco'), costeSocios: deSocios('costeReal'), margen, resultado, hacienda, caja, ajustes: activos.map((a) => a.concepto) });
    restaurantes = pagando - bajas;
  }

  const minimo = filas.reduce((m, f) => (f.caja < m.caja ? f : m), { caja: base.cajaInicial, mes: null });
  const rentable = filas.find((f, i) => f.resultado >= 0 && filas.slice(i).every((g) => g.resultado >= 0));
  return {
    filas,
    resumen: {
      cajaFinal: filas.length ? filas[filas.length - 1].caja : base.cajaInicial,
      mesFinal: filas.length ? filas[filas.length - 1].mes : null,
      minimo: minimo.mes ? { caja: minimo.caja, mes: minimo.mes } : null,
      rentableDesde: rentable ? rentable.mes : null,
      primerMesNegativo: (filas.find((f) => f.caja < 0) || {}).mes || null,
      margenMedio: filas.length ? filas.reduce((a, f) => a + f.margen, 0) / filas.length : 0,
      margenFinal: filas.length ? filas[filas.length - 1].margen : 0,
    },
  };
}

// ¿Cuánto podría costar al mes otro socio (sin IVA) sin que la caja baje nunca de cajaMinima en el horizonte?
// Entra desde el primer mes simulado, por factura o por nómina (la factura adelanta IVA, así que da algo menos).
export function huecoSocio(s, base, { modalidad = 'nomina', cajaMinima = 0 } = {}) {
  const cabe = (coste) => simular({ ...s, socios: [...(s.socios || []), { id: '_hueco', modalidad, coste }] }, base)
    .filas.every((f) => f.caja >= cajaMinima);
  if (!cabe(0)) return 0;
  let lo = 0, hi = 50000;
  if (cabe(hi)) return hi;
  while (hi - lo > 5) { const m = (lo + hi) / 2; if (cabe(m)) lo = m; else hi = m; }
  return Math.floor(lo / 10) * 10;
}
