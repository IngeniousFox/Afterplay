// La regla se mudó a src/shared/domain/nextPlaythroughLabel.ts porque ahora la
// necesita también la decisión pura de "a qué playthrough cuelga una sesión",
// que comparten el escritorio y el Worker. Esta reexportación existe solo para
// que createIteration siga importando de donde siempre.
export { nextPlaythroughLabel } from '../../../../shared/domain/nextPlaythroughLabel';
