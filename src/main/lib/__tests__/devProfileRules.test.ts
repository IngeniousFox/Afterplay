import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  activateDevProfile,
  devProfileBlocksBucket,
  devProfileBlocksRemote,
  isDevProfile,
  isDevResourceName,
  isValidProfileName,
  profileFolderName,
  resetDevProfileForTests,
  withDevProfileSuffix,
} from '../devProfileRules';

// LOS CERROJOS DEL PERFIL DE DESARROLLO.
//
// Un perfil trabaja sobre una copia de la biblioteca real. Lo que estos tests
// blindan es que esa copia no pueda escribir fuera de sí misma: ni en la base
// remota de producción ni en el bucket de partidas de producción, aunque
// alguien pegue sus credenciales en los Ajustes del perfil.

afterEach(() => resetDevProfileForTests());

describe('isDevResourceName', () => {
  it('acepta solo nombres que EMPIEZAN por un prefijo de desarrollo', () => {
    assert.equal(isDevResourceName('afterplay-dev'), true);
    assert.equal(isDevResourceName('afterplay-dev-copia-ingeniousfox'), true);
    assert.equal(isDevResourceName('afterplay-test-e2e-org'), true);
    assert.equal(isDevResourceName('afterplay-v2-hub'), true);
    assert.equal(isDevResourceName('afterplay2-test'), true);
    assert.equal(isDevResourceName('  Afterplay-Dev  '), true);
  });

  it('rechaza la base real aunque la organización contenga "dev" o "test"', () => {
    assert.equal(isDevResourceName('afterplay-ingeniousfox'), false);
    assert.equal(isDevResourceName('afterplay-mydevorg'), false);
    assert.equal(isDevResourceName('afterplay'), false);
    assert.equal(isDevResourceName('afterplay-saves'), false);
    assert.equal(isDevResourceName('afterplay2'), false);
    assert.equal(isDevResourceName('saves-afterplay-dev'), false);
    assert.equal(isDevResourceName(''), false);
    assert.equal(isDevResourceName(null), false);
    assert.equal(isDevResourceName(undefined), false);
  });
});

describe('nombre de perfil', () => {
  it('solo minúsculas, dígitos y guiones, y nada que salga de la carpeta', () => {
    assert.equal(isValidProfileName('v2'), true);
    assert.equal(isValidProfileName('v2-importador'), true);
    assert.equal(isValidProfileName(''), false);
    assert.equal(isValidProfileName('V2'), false);
    assert.equal(isValidProfileName('../Afterplay'), false);
    assert.equal(isValidProfileName('v2/x'), false);
    assert.equal(isValidProfileName('-v2'), false);
    assert.equal(isValidProfileName('a'.repeat(33)), false);
  });

  it('la carpeta nunca coincide con la de la app instalada', () => {
    assert.equal(profileFolderName('v2'), 'Afterplay-dev-v2');
    assert.notEqual(profileFolderName('v2'), 'Afterplay');
  });
});

describe('sin perfil activo (la app normal)', () => {
  it('no bloquea nada, tampoco producción', () => {
    assert.equal(isDevProfile(), false);
    assert.equal(devProfileBlocksRemote('afterplay-ingeniousfox'), false);
    assert.equal(devProfileBlocksBucket('afterplay-saves'), false);
    assert.equal(withDevProfileSuffix('Afterplay'), 'Afterplay');
  });
});

describe('con un perfil activo', () => {
  it('bloquea la base y el bucket que no son de desarrollo', () => {
    activateDevProfile('v2');
    assert.equal(isDevProfile(), true);
    assert.equal(devProfileBlocksRemote('afterplay-ingeniousfox'), true);
    assert.equal(devProfileBlocksBucket('afterplay-saves'), true);
  });

  it('deja pasar los recursos de desarrollo', () => {
    activateDevProfile('v2');
    assert.equal(devProfileBlocksRemote('afterplay-dev-ingeniousfox'), false);
    assert.equal(devProfileBlocksBucket('afterplay-dev'), false);
  });

  it('se distingue en el nombre que se enseña', () => {
    activateDevProfile('v2');
    assert.equal(withDevProfileSuffix('Afterplay'), 'Afterplay [dev: v2]');
  });

  it('no se puede cambiar de perfil a mitad de proceso', () => {
    activateDevProfile('v2');
    assert.doesNotThrow(() => activateDevProfile('v2'));
    assert.throws(() => activateDevProfile('otro'));
  });
});
