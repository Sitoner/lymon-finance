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

/**
 * @param s    supuestos: { restaurantes, nuevosMes (vendidos al mes), semanas (de la venta a la puesta en marcha), bajasMes, ticketMedio, precioPuestaMarcha, gastoMensual, horizonte, incluirHacienda, ajustes[] }
 *             ajuste: { id, concepto, efecto: 'gasto' | 'ingreso', importe, tipo: 'puntual' | 'mensual', desde, hasta? }
 * @param base datos reales: { mesInicio, cajaInicial, tipos: { ivaVentas, ivaGastos, irpfGastos },
 *             ivaMesesReales: { 'YYYY-MM': { rep, sop, ret } }, pagosPendientes: { 'YYYY-MM': importe }, compensarIva }
 */
export function simular(s, base) {
  const { ivaVentas, ivaGastos, irpfGastos } = base.tipos;
  const conIvaVentas = (x) => x * (1 + ivaVentas / 100);
  const divGastos = 100 + ivaGastos - irpfGastos;
  const ajustes = s.ajustes || [];
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
    const gastos = Math.max(0, (Number(s.gastoMensual) || 0) + gastoExtra);

    // IVA y retenciones que van dentro de los importes, para el pago trimestral a Hacienda
    ivaMes[mes] = {
      rep: ((cuotas + puestas) * ivaVentas) / (100 + ivaVentas),
      sop: (gastos * ivaGastos) / divGastos,
      ret: (gastos * irpfGastos) / divGastos,
    };
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
    filas.push({ mes, restaurantesInicio: pagando, vendidos, nuevos, bajas, cuotas, puestas, ingresoExtra, gastoExtra, ingresos, gastos, resultado, hacienda, caja, ajustes: activos.map((a) => a.concepto) });
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
    },
  };
}
