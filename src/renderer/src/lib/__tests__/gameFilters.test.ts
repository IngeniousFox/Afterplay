// QUE BLINDA: la semantica de applyFilters descrita en el propio modulo — OR
// dentro de un grupo, AND entre grupos, y genero/banderas en AND consigo
// mismos — mas los bordes de eraOf (juego sin ano no cuela en ningun cubo) y
// del sort 'release-desc' (sin ano se va al final, no al ano 0). Tambien
// countActiveFilters, que el orden no cuenta como filtro.
//
// QUE ES REAL Y QUE ES DOBLE: GameListItem son objetos literales a mano, sin
// mocks — applyFilters/countActiveFilters son funciones puras sobre arrays.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameListItem } from '../../../../shared/types';
import { applyFilters, countActiveFilters, EMPTY_FILTERS } from '../gameFilters';

const makeGame = (overrides: Partial<GameListItem> = {}): GameListItem => ({
  id: 1,
  igdbId: null,
  steamAppId: null,
  title: 'Game',
  coverUrl: null,
  heroUrl: null,
  genres: null,
  isEmulated: false,
  endless: false,
  releaseYear: null,
  totalHours: 0,
  addedAt: new Date(2020, 0, 1),
  promotedAt: null,
  hltbMain: null,
  hltbMainExtras: null,
  hltbCompletionist: null,
  executablePath: null,
  manualIterations: [],
  currentState: null,
  lastPlayedAt: null,
  isLive: false,
  liveSince: null,
  sessionCount: 0,
  ...overrides,
});

describe('applyFilters', () => {
  it('dentro del MISMO grupo va en OR: Playing o Beaten trae los dos estados', () => {
    const playing = makeGame({ id: 1, currentState: 'started' });
    const beaten = makeGame({ id: 2, currentState: 'completed' });
    const dropped = makeGame({ id: 3, currentState: 'dropped' });
    const result = applyFilters([playing, beaten, dropped], {
      ...EMPTY_FILTERS,
      statuses: ['playing', 'beaten'],
    });
    assert.deepEqual(result.map((g) => g.id).sort(), [1, 2]);
  });

  it('entre grupos DISTINTOS va en AND: estado Y era a la vez, no una u otra', () => {
    const playingNow = makeGame({ id: 1, currentState: 'started', releaseYear: 2022 });
    const playingOld = makeGame({ id: 2, currentState: 'started', releaseYear: 2005 });
    const beatenNow = makeGame({ id: 3, currentState: 'completed', releaseYear: 2022 });
    const result = applyFilters([playingNow, playingOld, beatenNow], {
      ...EMPTY_FILTERS,
      statuses: ['playing'],
      eras: ['now'],
    });
    assert.deepEqual(
      result.map((g) => g.id),
      [1],
    );
  });

  it('el genero va en AND consigo mismo: RPG y Strategy exige las DOS, no basta con una', () => {
    const both = makeGame({ id: 1, genres: ['RPG', 'Strategy'] });
    const onlyRpg = makeGame({ id: 2, genres: ['RPG'] });
    const result = applyFilters([both, onlyRpg], {
      ...EMPTY_FILTERS,
      genres: ['RPG', 'Strategy'],
    });
    assert.deepEqual(
      result.map((g) => g.id),
      [1],
    );
  });

  it('las banderas tambien van en AND consigo mismas: Emulado y Endless exige las dos', () => {
    const bothFlags = makeGame({ id: 1, isEmulated: true, endless: true });
    const onlyEmulated = makeGame({ id: 2, isEmulated: true, endless: false });
    const result = applyFilters([bothFlags, onlyEmulated], {
      ...EMPTY_FILTERS,
      flags: ['emulated', 'endless'],
    });
    assert.deepEqual(
      result.map((g) => g.id),
      [1],
    );
  });

  it('un juego sin ano de lanzamiento no cuela en NINGUN cubo de era', () => {
    const noYear = makeGame({ id: 1, releaseYear: null });
    const tens = makeGame({ id: 2, releaseYear: 2015 });
    const result = applyFilters([noYear, tens], { ...EMPTY_FILTERS, eras: ['tens'] });
    assert.deepEqual(
      result.map((g) => g.id),
      [2],
    );
  });

  it('release-desc manda los juegos sin ano al final, no los trata como ano 0', () => {
    const noYear = makeGame({ id: 1, title: 'Sin ano', releaseYear: null });
    const recent = makeGame({ id: 2, title: 'Reciente', releaseYear: 2023 });
    const old = makeGame({ id: 3, title: 'Viejo', releaseYear: 1998 });
    const result = applyFilters([noYear, recent, old], { ...EMPTY_FILTERS, sort: 'release-desc' });
    assert.deepEqual(
      result.map((g) => g.id),
      [2, 3, 1],
    );
  });
});

describe('countActiveFilters', () => {
  it('el orden NO cuenta como filtro activo, aunque no sea el alfabetico por defecto', () => {
    assert.equal(countActiveFilters({ ...EMPTY_FILTERS, sort: 'hours-desc' }), 0);
  });

  it('suma los chips de todos los grupos', () => {
    assert.equal(
      countActiveFilters({
        statuses: ['playing'],
        genres: ['RPG', 'Strategy'],
        playtime: ['long'],
        eras: [],
        flags: ['emulated'],
        sort: 'title',
      }),
      5,
    );
  });
});
