export type ContactoBlock = 'INTERNOS' | 'EXTERNOS' | 'ADC' | 'CAB' | 'FEBAMBA' | 'ECUADOR';

export type ContactoCategory =
  | 'REALIZADOR'
  | 'CAMARA'
  | 'CONTROLADOR'
  | 'PERIODISTA'
  | 'CAMAROGRAFO'
  | 'RESPONSABLE_CLUB';

export interface ContactoProps {
  sourceBlock: ContactoBlock;
  category: ContactoCategory;
  league: string | null;
  club: string | null;
  name: string;
  phone: string | null;
  role: string | null;
  days: string | null;
  rowIndex: number;
  extra: Record<string, unknown>;
}
