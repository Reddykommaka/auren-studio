from pathlib import Path
root = Path('/data/data/com.termux/files/home/downloads/new-project')
p = root/'src/App.tsx'
s = p.read_text()
s = s.replace("  const [authLoading, setAuthLoading] = useState(false)\n", "  const [authLoading, setAuthLoading] = useState(false)\n  const [paymentLoading, setPaymentLoading] = useState(false)\n  const [paymentMessage, setPaymentMessage] = useState('')\n")
needle = "  const signOut = async () => {\n"
fn = '''  const startPayment = async () => {\n    if (subtotal <= 0 || paymentLoading) return\n    setPaymentLoading(true)\n    setPaymentMessage('')\n\n    try {\n      const { data, error } = await supabase.functions.invoke('create-razorpay-order', {\n        body: { amount: Math.round(subtotal * 100) },\n      })\n      if (error || !data?.orderId || !data?.keyId) throw new Error(error?.message || data?.error || 'Unable to start checkout')\n\n      if (!window.Razorpay) throw new Error('Payment checkout is still loading. Please try again.')\n\n      const checkout = new window.Razorpay({\n        key: data.keyId,\n        amount: data.amount,\n        currency: data.currency || 'INR',\n        name: 'AUREN',\n        description: 'AUREN Studio order',\n        order_id: data.orderId,\n        prefill: userEmail ? { email: userEmail } : undefined,\n        theme: { color: '#171614' },\n        handler: async (response) => {\n          const verification = await supabase.functions.invoke('verify-razorpay-payment', { body: response })\n          if (verification.error || !verification.data?.verified) {\n            setPaymentMessage(verification.error?.message || verification.data?.error || 'Payment could not be verified.')\n            return\n          }\n          setCart([])\n          setCartOpen(false)\n          setPaymentMessage('Payment successful. Your AUREN order is confirmed.')\n        },\n      })\n      checkout.open()\n    } catch (error) {\n      console.error('AUREN PAYMENT ERROR:', error)\n      setPaymentMessage(error instanceof Error ? error.message : 'Unable to start payment.')\n    } finally {\n      setPaymentLoading(false)\n    }\n  }\n\n'''
s = s.replace(needle, fn + needle, 1)
s = s.replace('<button className="cta cta-dark">Proceed to checkout <Arrow /></button><small>Taxes and delivery calculated at checkout.</small>', '<button className="cta cta-dark" onClick={() => void startPayment()} disabled={paymentLoading}>{paymentLoading ? "Opening secure checkout…" : "Proceed to checkout"} <Arrow /></button>{paymentMessage && <small className="payment-message" role="status">{paymentMessage}</small>}<small>Taxes and delivery calculated at checkout.</small>', 1)
p.write_text(s)
idx = root/'index.html'
h = idx.read_text()
h = h.replace('    <script type="module" src="/src/main.tsx"></script>', '    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>\n    <script type="module" src="/src/main.tsx"></script>')
idx.write_text(h)
print('payment patch applied')


