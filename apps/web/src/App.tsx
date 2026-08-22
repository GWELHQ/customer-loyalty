import { Permission } from '@loyalty/shared';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireStaff } from './auth/RequireStaff';
import { AuditLog } from './pages/AuditLog';
import { Attendants } from './pages/Attendants';
import { CashbackLedgers } from './pages/CashbackLedgers';
import { CustomerCreate } from './pages/customers/CustomerCreate';
import { CustomerImportWizard } from './pages/customers/CustomerImportWizard';
import { CustomerProfile } from './pages/customers/CustomerProfile';
import { CustomersList } from './pages/customers/CustomersList';
import { CustomerRegistrations } from './pages/CustomerRegistrations';
import { Dashboard } from './pages/Dashboard';
import { Disbursements } from './pages/Disbursements';
import { Notifications } from './pages/Notifications';
import { PendingActivation } from './pages/PendingActivation';
import { Prices } from './pages/Prices';
import { Reconciliation } from './pages/Reconciliation';
import { Reports } from './pages/Reports';
import { SalesList } from './pages/SalesList';
import { SignIn } from './pages/SignIn';
import { SpecialRates } from './pages/SpecialRates';
import { Stations } from './pages/Stations';
import { Users } from './pages/Users';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<SignIn />} />
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

      <Route path="/cashback-ledgers" element={<RequireStaff permission={Permission.LEDGERS_VIEW}><CashbackLedgers /></RequireStaff>} />
      <Route path="/disbursements" element={<RequireStaff permission={Permission.DISBURSEMENTS_VIEW}><Disbursements /></RequireStaff>} />

      <Route path="/reports" element={<RequireStaff><Reports /></RequireStaff>} />
      <Route path="/notifications" element={<RequireStaff><Notifications /></RequireStaff>} />
      <Route path="/audit-log" element={<RequireStaff permission={Permission.AUDIT_VIEW}><AuditLog /></RequireStaff>} />
      <Route path="/users" element={<RequireStaff permission={Permission.USERS_MANAGE}><Users /></RequireStaff>} />
      <Route path="/attendants" element={<RequireStaff permission={Permission.ATTENDANTS_MANAGE}><Attendants /></RequireStaff>} />
      <Route path="/stations" element={<RequireStaff permission={Permission.STATIONS_VIEW}><Stations /></RequireStaff>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
