import { Permission } from '@loyalty/shared';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireStaff } from './auth/RequireStaff';
import { Apk } from './pages/Apk';
import { ApkVersions } from './pages/ApkVersions';
import { Attendants } from './pages/Attendants';
import { CashbackLedgers } from './pages/CashbackLedgers';
import { CustomerCreate } from './pages/customers/CustomerCreate';
import { CustomerImportWizard } from './pages/customers/CustomerImportWizard';
import { CustomerProfile } from './pages/customers/CustomerProfile';
import { CustomersList } from './pages/customers/CustomersList';
import { CustomerRegistrations } from './pages/CustomerRegistrations';
import { Dashboard } from './pages/Dashboard';
import { Disbursements } from './pages/Disbursements';
import { FraudGovernance } from './pages/FraudGovernance';
import { Logs } from './pages/Logs';
import { PendingActivation } from './pages/PendingActivation';
import { Prices } from './pages/Prices';
import { Reconciliation } from './pages/Reconciliation';
import { Reports } from './pages/Reports';
import { RolesAdmin } from './pages/RolesAdmin';
import { SalesList } from './pages/SalesList';
import { Shifts } from './pages/Shifts';
import { SignIn } from './pages/SignIn';
import { SpecialRates } from './pages/SpecialRates';
import { Stations } from './pages/Stations';
import { Users } from './pages/Users';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<SignIn />} />
      <Route path="/apk" element={<Apk />} />
      {/* MSAL popup redirect target — the library closes the popup itself once it detects the response; this route just needs to exist so it doesn't 404 mid-flow. */}
      <Route path="/auth/microsoft/callback" element={<div />} />

      <Route path="/pending-activation" element={<RequireStaff><PendingActivation /></RequireStaff>} />

      <Route
        path="/dashboard"
        element={
          <RequireStaff anyPermission={[Permission.REPORTS_VIEW_ALL, Permission.REPORTS_VIEW_OWN_STATION]}>
            <Dashboard />
          </RequireStaff>
        }
      />

      <Route path="/customers" element={<RequireStaff permission={Permission.CUSTOMERS_VIEW}><CustomersList /></RequireStaff>} />
      <Route path="/customers/new" element={<RequireStaff permission={Permission.CUSTOMERS_MANAGE}><CustomerCreate /></RequireStaff>} />
      <Route path="/customers/import" element={<RequireStaff permission={Permission.CUSTOMERS_IMPORT}><CustomerImportWizard /></RequireStaff>} />
      <Route path="/customers/:id" element={<RequireStaff permission={Permission.CUSTOMERS_VIEW}><CustomerProfile /></RequireStaff>} />

      <Route path="/sales" element={<RequireStaff><SalesList /></RequireStaff>} />
      {/*
        No permission prop, deliberately — a delegate granted approval
        access for a station may hold no permission at all normally
        (delegation can name any staff member). The nav item is still
        permission-gated for discoverability; this route itself defers to
        the page/API to decide what the actor can actually do.
      */}

      <Route path="/prices" element={<RequireStaff permission={Permission.PRICES_VIEW}><Prices /></RequireStaff>} />

      <Route path="/special-rates" element={<RequireStaff permission={Permission.SPECIAL_RATES_VIEW}><SpecialRates /></RequireStaff>} />

      <Route
        path="/customer-registrations"
        element={
          <RequireStaff permission={Permission.CUSTOMER_REGISTRATIONS_VIEW}>
            <CustomerRegistrations />
          </RequireStaff>
        }
      />

      <Route path="/reconciliation" element={<RequireStaff><Reconciliation /></RequireStaff>} />

      <Route
        path="/shifts"
        element={
          <RequireStaff anyPermission={[Permission.SHIFTS_VIEW_ALL, Permission.SHIFTS_VIEW_OWN_STATION]}>
            <Shifts />
          </RequireStaff>
        }
      />

      <Route
        path="/cashback-ledgers"
        element={
          <RequireStaff anyPermission={[Permission.LEDGERS_VIEW, Permission.LEDGERS_RELEASE_OWN_STATION]}>
            <CashbackLedgers />
          </RequireStaff>
        }
      />
      <Route path="/disbursements" element={<RequireStaff permission={Permission.DISBURSEMENTS_VIEW}><Disbursements /></RequireStaff>} />

      <Route path="/reports" element={<RequireStaff><Reports /></RequireStaff>} />
      <Route path="/logs" element={<RequireStaff permission={Permission.AUDIT_VIEW}><Logs /></RequireStaff>} />
      {/* Old path, kept as a redirect in case it's bookmarked/linked anywhere. */}
      <Route path="/audit-log" element={<Navigate to="/logs" replace />} />
      <Route path="/fraud" element={<RequireStaff permission={Permission.FRAUD_VIEW}><FraudGovernance /></RequireStaff>} />
      <Route path="/users" element={<RequireStaff permission={Permission.USERS_MANAGE}><Users /></RequireStaff>} />
      <Route path="/roles" element={<RequireStaff permission={Permission.RBAC_MANAGE}><RolesAdmin /></RequireStaff>} />
      <Route path="/attendants" element={<RequireStaff permission={Permission.ATTENDANTS_MANAGE}><Attendants /></RequireStaff>} />
      <Route path="/stations" element={<RequireStaff permission={Permission.STATIONS_VIEW}><Stations /></RequireStaff>} />
      <Route path="/apk-versions" element={<RequireStaff permission={Permission.APK_MANAGE}><ApkVersions /></RequireStaff>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
