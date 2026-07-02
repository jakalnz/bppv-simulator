import { KAPPA_FLOW, TAU_CUPULA } from './params';

/**
 * Cupula deflection update: driven by endolymph flow (proportional to clot velocity,
 * not clot position), relaxing back toward neutral with time constant TAU_CUPULA.
 * Semi-implicit (backward Euler on the decay term) so it stays stable for any dt:
 *   beta_new = (beta_old + KAPPA_FLOW * dsdt * dt) / (1 + dt / TAU_CUPULA)
 * Fatigue and "nystagmus duration" clinical patterns fall out of this relaxation --
 * they are not scripted separately.
 */
export function updateCupula(beta: number, dsdt: number, dt: number): number {
  const driven = beta + KAPPA_FLOW * dsdt * dt;
  return driven / (1 + dt / TAU_CUPULA);
}

/** Relaxation with no driving flow, e.g. once the clot has cleared past the common crus. */
export function relaxOnly(beta: number, dt: number): number {
  return updateCupula(beta, 0, dt);
}
