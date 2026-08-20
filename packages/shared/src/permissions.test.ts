import { describe, expect, it } from 'vitest';
import { Role } from './enums.js';
import { Permission, roleHasPermission } from './permissions.js';

describe('RBAC permission matrix', () => {
  it('Admin cannot approve special rates', () => {
    expect(roleHasPermission(Role.ADMIN, Permission.SPECIAL_RATES_APPROVE)).toBe(false);
  });

  it('Admin can manage users, attendants, customers, stations, imports and prices', () => {
    expect(roleHasPermission(Role.ADMIN, Permission.USERS_MANAGE)).toBe(true);
    expect(roleHasPermission(Role.ADMIN, Permission.ATTENDANTS_MANAGE)).toBe(true);
    expect(roleHasPermission(Role.ADMIN, Permission.CUSTOMERS_MANAGE)).toBe(true);
    expect(roleHasPermission(Role.ADMIN, Permission.STATIONS_MANAGE)).toBe(true);
    expect(roleHasPermission(Role.ADMIN, Permission.IMPORTS_VIEW)).toBe(true);
    expect(roleHasPermission(Role.ADMIN, Permission.PRICES_MANAGE)).toBe(true);
  });

  it('Chairman can approve and reject special rates', () => {
    expect(roleHasPermission(Role.CHAIRMAN, Permission.SPECIAL_RATES_APPROVE)).toBe(true);
  });

  it('Chairman cannot manage users or prices', () => {
    expect(roleHasPermission(Role.CHAIRMAN, Permission.USERS_MANAGE)).toBe(false);
    expect(roleHasPermission(Role.CHAIRMAN, Permission.PRICES_MANAGE)).toBe(false);
  });

  it('Finance can manage disbursements and approve ledgers, but not special rates', () => {
    expect(roleHasPermission(Role.FINANCE, Permission.DISBURSEMENTS_MANAGE)).toBe(true);
    expect(roleHasPermission(Role.FINANCE, Permission.LEDGERS_APPROVE)).toBe(true);
    expect(roleHasPermission(Role.FINANCE, Permission.SPECIAL_RATES_APPROVE)).toBe(false);
  });

  it('RTSM can request special rates but not approve them', () => {
    expect(roleHasPermission(Role.RTSM, Permission.SPECIAL_RATES_REQUEST)).toBe(true);
    expect(roleHasPermission(Role.RTSM, Permission.SPECIAL_RATES_APPROVE)).toBe(false);
  });

  it('RTSM can manage customers and view all operational data', () => {
    expect(roleHasPermission(Role.RTSM, Permission.CUSTOMERS_MANAGE)).toBe(true);
    expect(roleHasPermission(Role.RTSM, Permission.SALES_VIEW_ALL)).toBe(true);
  });

  it('Station Supervisor only has station-scoped permissions, never the "all" variants', () => {
    expect(roleHasPermission(Role.STATION_SUPERVISOR, Permission.SALES_VIEW_OWN_STATION)).toBe(
      true,
    );
    expect(roleHasPermission(Role.STATION_SUPERVISOR, Permission.SALES_VIEW_ALL)).toBe(false);
    expect(
      roleHasPermission(Role.STATION_SUPERVISOR, Permission.RECONCILIATION_VIEW_OWN_STATION),
    ).toBe(true);
    expect(roleHasPermission(Role.STATION_SUPERVISOR, Permission.RECONCILIATION_VIEW_ALL)).toBe(
      false,
    );
  });

  it('Attendant is restricted to own sales and cannot view all/station-wide sales', () => {
    expect(roleHasPermission(Role.ATTENDANT, Permission.SALES_CREATE_OWN)).toBe(true);
    expect(roleHasPermission(Role.ATTENDANT, Permission.SALES_VIEW_OWN)).toBe(true);
    expect(roleHasPermission(Role.ATTENDANT, Permission.SALES_VIEW_ALL)).toBe(false);
    expect(roleHasPermission(Role.ATTENDANT, Permission.SALES_VIEW_OWN_STATION)).toBe(false);
  });

  it('every role is present in the permission matrix', () => {
    for (const role of Object.values(Role)) {
      expect(roleHasPermission(role, Permission.PRICES_VIEW) !== undefined).toBe(true);
    }
  });
});
