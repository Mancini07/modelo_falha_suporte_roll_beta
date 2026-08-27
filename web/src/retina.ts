import type { PositionInfo } from './types';

/**
 * Endereço do Retina. Configurável para o caso de outro ambiente; o padrão é
 * a produção.
 */
const RETINA_BASE =
  (import.meta.env.VITE_RETINA_BASE_URL as string | undefined) ?? 'https://retina.ibbx.tech';

/**
 * Link direto para o ponto no Retina. Precisa da empresa, da unidade e do
 * ponto — sem qualquer um dos três a página não abre no lugar certo, então
 * devolve null e a interface omite o link em vez de mandar para lugar nenhum.
 */
export function retinaPositionUrl(point: PositionInfo): string | null {
  const { companyId, facilityId, positionId } = point;
  if (companyId == null || facilityId == null || positionId == null) return null;

  const qs = new URLSearchParams({
    facilityId: String(facilityId),
    positionId: String(positionId),
    mode: 'management',
    tab: 'GENERAL_DASHBOARD',
  });
  return `${RETINA_BASE}/companies/${companyId}/facilities?${qs}`;
}
