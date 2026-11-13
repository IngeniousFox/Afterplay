import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSteamReviewCounts } from '../reviews';

// La interpretación de lo que contesta IUserReviewsService/GetAppReviews.
//
// Las formas de abajo son las que devolvía la API el 13-nov-2026, recortadas a
// lo que se usa. Existen porque el endpoint anterior murió por un cambio de
// forma (HTML donde había JSON) y la función pasó a devolver null para todos
// los juegos sin que fallara ningún test: no había ninguno.

describe('parseSteamReviewCounts', () => {
  it('lee los totales del resumen', () => {
    const payload = {
      response: {
        query_summary: {
          num_reviews: 1,
          review_score: 8,
          review_score_desc: 'Very Positive',
          total_positive: 15469,
          total_negative: 910,
          total_reviews: 16379,
        },
        reviews: [{ recommendationid: '1' }],
        cursor: 'abc',
        total_matching: 132,
      },
    };
    assert.deepEqual(parseSteamReviewCounts(payload), {
      steamPositive: 15469,
      steamNegative: 910,
    });
  });

  it('dos ceros son un resultado, no una ausencia', () => {
    const payload = { response: { query_summary: { total_positive: 0, total_negative: 0 } } };
    assert.deepEqual(parseSteamReviewCounts(payload), { steamPositive: 0, steamNegative: 0 });
  });

  it('un appid que no existe contesta una respuesta vacía: null', () => {
    assert.equal(parseSteamReviewCounts({ response: {} }), null);
  });

  it('un resumen sin totales (páginas siguientes, o filtrado por tipo) es null', () => {
    assert.equal(
      parseSteamReviewCounts({ response: { query_summary: { num_reviews: 20 } } }),
      null,
    );
    assert.equal(
      parseSteamReviewCounts({ response: { query_summary: { total_positive: 5 } } }),
      null,
    );
  });

  it('la forma del endpoint retirado ya no vale: null, no un número inventado', () => {
    // Lo que devolvía store.steampowered.com/appreviews: sin envoltorio.
    const old = { success: 1, query_summary: { total_positive: 10, total_negative: 2 } };
    assert.equal(parseSteamReviewCounts(old), null);
  });

  it('cualquier cosa que no sea la respuesta esperada es null y no lanza', () => {
    for (const payload of [
      '<!DOCTYPE html><html><title>Welcome to Steam</title></html>',
      '',
      null,
      undefined,
      42,
      [],
      { response: null },
      { response: { query_summary: { total_positive: '10', total_negative: '2' } } },
    ]) {
      assert.equal(parseSteamReviewCounts(payload), null);
    }
  });
});
