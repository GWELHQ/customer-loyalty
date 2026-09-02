import { describe, expect, it } from 'vitest';
import { Role } from './enums.js';
import { getPermissionsForRole, Permission, roleHasPermission } from './permissions.js';

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

  it('Finance Approver can approve ledgers but not execute disbursements or special rates', () => {
    expect(roleHasPermission(Role.FINANCE_APPROVER, Permission.LEDGERS_APPROVE)).toBe(true);
    expect(roleHasPermission(Role.FINANCE_APPROVER, Permission.DISBURSEMENTS_MANAGE)).toBe(false);
    expect(roleHasPermission(Role.FINANCE_APPROVER, Permission.SPECIAL_RATES_APPROVE)).toBe(false);
  });

  it('Finance Disburser can manage disbursements but not approve a ledger (segregation of duties)', () => {
    expect(roleHasPermission(Role.FINANCE_DISBURSER, Permission.DISBURSEMENTS_MANAGE)).toBe(true);
    expect(roleHasPermission(Role.FINANCE_DISBURSER, Permission.LEDGERS_APPROVE)).toBe(false);
  });

  it('RTSM can release the monthly ledger but not approve it', () => {
    expect(roleHasPermission(Role.RTSM, Permission.LEDGERS_MANAGE)).toBe(true);
    expect(roleHasPermission(Role.RTSM, Permission.LEDGERS_APPROVE)).toBe(false);
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

  it('Super Admin has every Admin permission plus rbac:manage, which Admin does not have', () => {
    expect(roleHasPermission(Role.ADMIN, Permission.RBAC_MANAGE)).toBe(false);
    expect(roleHasPermission(Role.SUPER_ADMIN, Permission.RBAC_MANAGE)).toBe(true);
    const adminOnly = getPermissionsForRole(Role.ADMIN).filter((p) => p !== Permission.RBAC_MANAGE);
    const superAdminOnly = getPermissionsForRole(Role.SUPER_ADMIN).filter((p) => p !== Permission.RBAC_MANAGE);
    expect(superAdminOnly.sort()).toEqual(adminOnly.sort());
  });

  it('every role is present in the permission matrix', () => {
    for (const role of Object.values(Role)) {
      expect(roleHasPermission(role, Permission.PRICES_VIEW) !== undefined).toBe(true);
    }
  });
});
