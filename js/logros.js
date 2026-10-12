/**
 * Retos y logros. Todo se calcula a partir de los municipios visitados:
 * no se guarda nada aparte, así que al borrar una visita el logro se recalcula.
 *
 * Regiones naturales asignadas por departamento (aproximación habitual):
 * Chocó, Valle, Cauca y Nariño cuentan como Pacífica aunque tengan zona andina.
 */
import { anioDe } from './utils.js';

export const REGIONES = [
  { id: 'caribe', nombre: 'Caribe', deptos: ['08', '13', '20', '23', '44', '47', '70'] },
  { id: 'andina', nombre: 'Andina', deptos: ['05', '11', '15', '17', '25', '41', '54', '63', '66', '68', '73'] },
  { id: 'pacifica', nombre: 'Pacífica', deptos: ['19', '27', '52', '76'] },
  { id: 'orinoquia', nombre: 'Orinoquía', deptos: ['50', '81', '85', '99'] },
  { id: 'amazonia', nombre: 'Amazonía', deptos: ['18', '86', '91', '94', '95', '97'] },
  { id: 'insular', nombre: 'Insular', deptos: ['88'] },
];

const EJE_CAFETERO = ['17', '63', '66'];

/** Capital de cada departamento: su código + 001, salvo Cundinamarca (Bogotá). */
function capitales(datos) {
  return [...new Set(datos.listaDeptos.map((d) => (d.id === '25' ? '11001' : `${d.id}001`)))]
    .filter((id) => datos.porId.has(id));
}

/** Para retos con varios niveles: siguiente meta y nivel alcanzado. */
function porNiveles(actual, niveles) {
  const alcanzados = niveles.filter((n) => actual >= n).length;
  const meta = niveles[Math.min(alcanzados, niveles.length - 1)];
  return { actual, meta, nivel: alcanzados, niveles: niveles.length, completado: alcanzados === niveles.length };
}

function conjunto(visitados, ids) {
  const pendientes = ids.filter((id) => !visitados.has(id));
  return {
    actual: ids.length - pendientes.length,
    meta: ids.length,
    completado: pendientes.length === 0,
    pendientes,
  };
}

/**
 * @param {object} p
 * @param {object} p.datos      resultado de cargarDatos()
 * @param {Map<string,string>} p.ultimas  DIVIPOLA → fecha de la última visita
 * @param {object[]} p.visitas  todas las visitas
 * @param {Set<string>} p.deseos
 * @returns {object[]} retos con { id, titulo, descripcion, actual, meta, completado, nivel?, pendientes? }
 */
export function calcularLogros({ datos, ultimas, visitas, deseos }) {
  const visitados = new Set(ultimas.keys());
  const porDepto = new Map();
  for (const id of visitados) {
    const dpto = datos.porId.get(id)?.dpto;
    if (dpto) porDepto.set(dpto, (porDepto.get(dpto) ?? 0) + 1);
  }
  const idsDe = (deptos) => deptos.flatMap((d) => datos.deptos.get(d)?.ids ?? []);
  const deptosCompletos = datos.listaDeptos.filter((d) => (porDepto.get(d.id) ?? 0) === d.ids.length).length;

  // Mayor número de meses distintos con visitas dentro de un mismo año.
  const mesesPorAnio = new Map();
  for (const v of visitas) {
    const a = anioDe(v.fecha);
    if (!mesesPorAnio.has(a)) mesesPorAnio.set(a, new Set());
    mesesPorAnio.get(a).add(v.fecha.slice(5, 7));
  }
  const maxMeses = Math.max(0, ...[...mesesPorAnio.values()].map((s) => s.size));

  const cumplidos = [...deseos].filter((id) => visitados.has(id)).length;

  const logros = [
    {
      id: 'municipios',
      titulo: 'Explorador',
      descripcion: 'Municipios visitados.',
      ...porNiveles(visitados.size, [1, 10, 25, 50, 100, 250, 500, datos.total]),
    },
    {
      id: 'capitales',
      titulo: 'Todas las capitales',
      descripcion: 'Visita la capital de cada departamento.',
      ...conjunto(visitados, capitales(datos)),
    },
    {
      id: 'departamentos',
      titulo: 'Todo el país',
      descripcion: 'Al menos un municipio en cada departamento y en Bogotá.',
      actual: porDepto.size,
      meta: datos.listaDeptos.length,
      completado: porDepto.size === datos.listaDeptos.length,
      pendientesDeptos: datos.listaDeptos.filter((d) => !porDepto.has(d.id)).map((d) => d.id),
    },
    {
      id: 'regiones',
      titulo: 'Las seis regiones',
      descripcion: 'Pisa las regiones Caribe, Andina, Pacífica, Orinoquía, Amazonía e Insular.',
      actual: REGIONES.filter((r) => r.deptos.some((d) => porDepto.has(d))).length,
      meta: REGIONES.length,
      completado: REGIONES.every((r) => r.deptos.some((d) => porDepto.has(d))),
    },
    {
      id: 'eje-cafetero',
      titulo: 'Todo el Eje Cafetero',
      descripcion: 'Todos los municipios de Caldas, Quindío y Risaralda.',
      ...conjunto(visitados, idsDe(EJE_CAFETERO)),
    },
    {
      id: 'deptos-completos',
      titulo: 'Departamento completo',
      descripcion: 'Departamentos con todos sus municipios visitados.',
      ...porNiveles(deptosCompletos, [1, 5, 10, datos.listaDeptos.length]),
    },
    {
      id: 'doce-meses',
      titulo: 'Un año en ruta',
      descripcion: 'Visitas en los 12 meses de un mismo año.',
      actual: maxMeses,
      meta: 12,
      completado: maxMeses === 12,
    },
    {
      id: 'deseos',
      titulo: 'Sueños cumplidos',
      descripcion: 'Municipios de tu lista "Quiero ir" que ya visitaste.',
      ...porNiveles(cumplidos, [1, 5, 10, 25, 50]),
    },
    ...REGIONES.map((r) => ({
      id: `region-${r.id}`,
      titulo: `Región ${r.nombre} completa`,
      descripcion: `Todos los municipios de la región ${r.nombre}.`,
      grupo: 'regiones',
      ...conjunto(visitados, idsDe(r.deptos)),
    })),
  ];

  // Los pendientes solo se muestran cuando son pocos (si no, la lista no ayuda).
  for (const l of logros) if (l.pendientes && l.pendientes.length > 40) delete l.pendientes;
  return logros;
}
