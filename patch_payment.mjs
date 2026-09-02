import fs from 'node:fs'
const root = '/data/data/com.termux/files/home/downloads/new-project'
const app = `${root}/src/App.tsx`
const html = `${root}/index.html`
let s = fs.readFileSync(app, 'utf8')
s = s.replace("  const [authLoading, setAuthLoading] = useState(false)\n", "  const [authLoading, setAuthLoading] = useState(false)\n  const [paymentLoading, setPaymentLoading] = useState(false)\n  const [paymentMessage, setPaymentMessage] = useState('')\n")
const marker = "  const signOut = async () => {\n"
const fn = `  const startPayment = async () => {\n    if (subtotal <= 0 || paymentLoading) return\n    setPaymentLoading(true)\n    setPaymentMessage('')\n    try {\n      const { data, error } = await supabase.functions.invoke('create-razorpay-order', { body: { amount: Math.round(subtotal * 100) } })\n      if (error || !data?.orderId || !data?.keyId) throw new Error(error?.message || data?.error || 'Unable to start checkout')\n      if (!window.Razorpay) throw new Error('Payment checkout is still loading. Please try again.')\n      const checkout = new window.Razorpay({\n        key: data.keyId, amount: data.amount, currency: data.currency || 'INR', name: 'AUREN',\n        description: 'AUREN Studio order', order_id: data.orderId, prefill: userEmail ? { email: userEmail } : undefined,\n        theme: { color: '#171614' },\n        handler: async (response) => {\n          const result = await supabase.functions.invoke('verify-razorpay-payment', { body: response })\n          if (result.error || !result.data?.verified) { setPaymentMessage(result.error?.message || result.data?.error || 'Payment could not be verified.'); return }\n          setCart([]); setCartOpen(false); setPaymentMessage('Payment successful. Your AUREN order is confirmed.')\n        },\n      })\n      checkout.open()\n    } catch (error) {\n      console.error('AUREN PAYMENT ERROR:', error)\n      setPaymentMessage(error instanceof Error ? error.message : 'Unable to start payment.')\n    } finally { setPaymentLoading(false) }\n  }\n\n`
if (!s.includes('const startPayment')) s = s.replace(marker, fn + marker)
s = s.replace('<button className="cta cta-dark">Proceed to checkout <Arrow /></button><small>Taxes and delivery calculated at checkout.</small>', '<button className="cta cta-dark" onClick={() => void startPayment()} disabled={paymentLoading}>{paymentLoading ? "Opening secure checkout…" : "Proceed to checkout"} <Arrow /></button>{paymentMessage && <small className="payment-message" role="status">{paymentMessage}</small>}<small>Taxes and delivery calculated at checkout.</small>')
fs.writeFileSync(app, s)
let h = fs.readFileSync(html, 'utf8')
if (!h.includes('checkout.razorpay.com')) h = h.replace('    <script type="module" src="/src/main.tsx"></script>', '    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>\n    <script type="module" src="/src/main.tsx"></script>')
fs.writeFileSync(html, h)
console.log('payment patch applied')
