// QUE BLINDA: los bordes exactos de getSessionGroup entre Today/Yesterday/
// This Week/Last Week/This Month/Last Month/mes-solo/mes+ano — en particular
// que el cubo de DIAS manda sobre el de MES incluso cruzando un cambio de
// mes (14 dias atras puede caer en el mes anterior y aun asi ser "Last
// Week", no "Last Month"). Y que groupPageByDate solo junta filas
// CONSECUTIVAS del mismo grupo, sin fundir dos grupos distintos.
//
// QUE ES REAL Y QUE ES DOBLE: aritmetica de calendario pura sobre objetos
// Date literales — no hace falta ningun doble.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSessionGroup, groupPageByDate } from '../sessionGroups';

// 3 de agosto de 2026, lunes: elegido para que "hace 14 dias" (20 de julio)
// caiga en el mes ANTERIOR, y asi poder distinguir el corte de dias del
// corte de mes.
const now = new Date(2026, 7, 3);

describe('getSessionGroup', () => {
  it('hoy es diffDays <= 0, sea cual sea la hora del dia', () => {
    assert.equal(getSessionGroup(new Date(2026, 7, 3, 23, 59), now).label, 'Today');
    assert.equal(getSessionGroup(new Date(2026, 7, 3, 0, 1), now).label, 'Today');
  });

  it('ayer es exactamente diffDays === 1', () => {
    assert.equal(getSessionGroup(new Date(2026, 7, 2), now).label, 'Yesterday');
  });

  it('This Week llega hasta 7 dias exactos, Last Week empieza en el dia 8', () => {
    assert.equal(getSessionGroup(new Date(2026, 6, 27), now).label, 'This Week'); // 7 dias
    assert.equal(getSessionGroup(new Date(2026, 6, 26), now).label, 'Last Week'); // 8 dias
  });

  it('el cubo de DIAS manda sobre el de MES: 14 dias atras es Last Week aunque caiga en julio', () => {
    const bucket = getSessionGroup(new Date(2026, 6, 20), now); // 14 dias, 20 julio
    assert.equal(bucket.label, 'Last Week');
    assert.equal(bucket.monthScopeKey, null);
  });

  it('a partir de 15 dias el corte pasa a ser por MES: Last Month si es el anterior', () => {
    const bucket = getSessionGroup(new Date(2026, 6, 19), now); // 15 dias, tambien julio
    assert.equal(bucket.label, 'Last Month');
    assert.equal(bucket.monthScopeKey, '2026-07');
  });

  it('This Month para el resto del mes en curso, y NUNCA se narra (monthScopeKey null)', () => {
    const lateMonth = new Date(2026, 6, 31); // ahora mas tarde en julio
    const bucket = getSessionGroup(new Date(2026, 6, 10), lateMonth); // 21 dias, mismo mes
    assert.equal(bucket.label, 'This Month');
    assert.equal(bucket.monthScopeKey, null);
  });

  it('mismo ano pero no el mes anterior: solo el nombre del mes, con su monthScopeKey', () => {
    const lateMonth = new Date(2026, 6, 31);
    const bucket = getSessionGroup(new Date(2026, 4, 5), lateMonth); // mayo, mismo ano
    assert.equal(bucket.label, 'May');
    assert.equal(bucket.monthScopeKey, '2026-05');
  });

  it('ano distinto: mes Y ano en la etiqueta', () => {
    const bucket = getSessionGroup(new Date(2024, 9, 12), now); // octubre de 2024
    assert.equal(bucket.label, 'October 2024');
    assert.equal(bucket.monthScopeKey, '2024-10');
  });
});

describe('groupPageByDate', () => {
  const pageNow = new Date(2026, 6, 31);

  it('junta filas CONSECUTIVAS del mismo grupo bajo una sola cabecera', () => {
    const sessions = [
      { startedAt: new Date(2026, 6, 31, 10, 0) },
      { startedAt: new Date(2026, 6, 31, 12, 0) },
      { startedAt: new Date(2026, 6, 30, 9, 0) }, // ayer: grupo distinto
    ];
    const groups = groupPageByDate(sessions, pageNow);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, 'Today');
    assert.equal(groups[0].sessions.length, 2);
    assert.equal(groups[1].label, 'Yesterday');
    assert.equal(groups[1].sessions.length, 1);
  });

  it('no funde dos grupos NO consecutivos aunque compartan etiqueta', () => {
    // "This Month" aparece, se interrumpe por una fila de otro grupo, y
    // vuelve a aparecer: tienen que salir como DOS grupos separados, no uno.
    const thisMonthA = new Date(2026, 6, 10);
    const thisWeek = new Date(2026, 6, 29);
    const thisMonthB = new Date(2026, 6, 12);
    const sessions = [
      { startedAt: thisMonthA },
      { startedAt: thisWeek },
      { startedAt: thisMonthB },
    ];
    const groups = groupPageByDate(sessions, pageNow);
    assert.deepEqual(
      groups.map((g) => g.label),
      ['This Month', 'This Week', 'This Month'],
    );
    assert.equal(groups[0].sessions.length, 1);
    assert.equal(groups[2].sessions.length, 1);
  });
});
