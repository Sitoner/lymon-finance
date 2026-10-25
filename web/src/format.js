const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export const fEur = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : eur.format(v));
export const fEur2 = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : eur2.format(v));
export const fNum = (v) => (v === null || v === undefined ? '—' : num.format(v));
export const fPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${num.format(v * 100)} %`);
// Los meses se muestran sin año: el año se elige con el selector general
export const fMes = (m) => (m ? MESES[Number(m.slice(5, 7)) - 1] : '');
export const fMesLargo = (m) => (m ? MESES_L[Number(m.slice(5, 7)) - 1] : '');
export const anioDe = (m) => (m ? Number(m.slice(0, 4)) : null);
export const delAnio = (meses, anio) => meses.filter((m) => anioDe(m) === anio);
export const fFecha = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '');
export const mesActual = () => new Date().toISOString().slice(0, 7);
