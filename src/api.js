const BASE = 'http://localhost:5000/api'

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// Super Admin
export const getAdminStats  = ()           => req('/admin/stats')
export const getCompanies   = ()           => req('/companies')
export const createCompany  = (data)       => req('/companies', { method: 'POST', body: JSON.stringify(data) })
export const updateCompany  = (id, data)   => req(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const getPlans       = ()           => req('/plans')
export const getSubscriptions = ()         => req('/subscriptions')
export const getUsers       = ()           => req('/users')
export const getAuditLogs   = ()           => req('/audit')
export const addAuditLog    = (data)       => req('/audit', { method: 'POST', body: JSON.stringify(data) })

// Typing ERP (cid = company_id)
export const getCustomers   = (cid)        => req(`/${cid}/customers`)
export const createCustomer = (cid, data)  => req(`/${cid}/customers`, { method: 'POST', body: JSON.stringify(data) })
export const getServices    = (cid)        => req(`/${cid}/services`)
export const getInvoices    = (cid, q='')  => req(`/${cid}/invoices${q}`)
export const getInvoice     = (cid, id)    => req(`/${cid}/invoices/${id}`)
export const createInvoice  = (cid, data)  => req(`/${cid}/invoices`, { method: 'POST', body: JSON.stringify(data) })
export const getInvoiceStats= (cid)        => req(`/${cid}/invoices/stats/summary`)
export const getApplications= (cid, q='')  => req(`/${cid}/applications${q}`)
export const createApplication=(cid,data)  => req(`/${cid}/applications`, { method: 'POST', body: JSON.stringify(data) })
export const updateApplication=(cid,id,data)=> req(`/${cid}/applications/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const getAccounts    = (cid)        => req(`/${cid}/accounts`)
export const getJournal     = (cid)        => req(`/${cid}/journal`)
export const getEInvQueue   = (cid)        => req(`/${cid}/einvoice/queue`)
export const getEInvLogs    = (cid)        => req(`/${cid}/einvoice/logs`)
export const queueInvoice   = (cid, invId) => req(`/${cid}/einvoice/queue`, { method: 'POST', body: JSON.stringify({ invoice_id: invId }) })
export const submitInvoice  = (cid, qid)   => req(`/${cid}/einvoice/submit/${qid}`, { method: 'POST' })

export const health = () => req('/health')
