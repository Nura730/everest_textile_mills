// The five roles of Everest Textile Mills. Stored on User.role; checked by authorize().
export const ROLES = Object.freeze({
  STORE_KEEPER: 'STORE_KEEPER',
  FLOOR_MANAGER: 'FLOOR_MANAGER',
  QC_INSPECTOR: 'QC_INSPECTOR',
  BUYER: 'BUYER',
  ADMIN: 'ADMIN',
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

export function isRole(value) {
  return ALL_ROLES.includes(value);
}
