import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

type Product = {
  id: string | number
  name: string
  price: number
  category: string
  image: string
  tone: string
  sizes: string[]
  description: string
}

const products: Product[] = [
  { id: 1, name: 'Form Shirt', price: 8900, category: 'Shirts', tone: 'Stone', sizes: ['S','M','L','XL'], description: 'A clean everyday shirt cut with quiet structure and an easy drape.' , image: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1000&q=88' },
  { id: 2, name: 'Structured Overshirt', price: 11900, category: 'Outerwear', tone: 'Charcoal', sizes: ['S','M','L','XL'], description: 'A considered outer layer with a precise silhouette for transitional days.', image: 'https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=1000&q=88' },
  { id: 3, name: 'Everyday Trouser', price: 9900, category: 'Trousers', tone: 'Ink', sizes: ['28','30','32','34','36'], description: 'An understated trouser designed to become part of the daily uniform.', image: 'https://images.unsplash.com/photo-1506629905607-d9f8a1c4e2bb?auto=format&fit=crop&w=1000&q=88' },
  { id: 4, name: 'Studio Knit', price: 10900, category: 'Knitwear', tone: 'Oat', sizes: ['S','M','L','XL'], description: 'A tactile knit with a relaxed proportion and refined finish.', image: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=1000&q=88' },
]

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
const Arrow = () => <span aria-hidden="true">↗</span>

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [cart, setCart] = useState<(Product & { size: string; quantity: number })[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('auren-cart') || '[]')
    } catch {
      return []
    }
  })
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedSize, setSelectedSize] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [email, setEmail] = useState('')
  const [dbProducts, setDbProducts] = useState<Product[]>([])
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState('')

  useEffect(() => {
    localStorage.setItem('auren-cart', JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    let mounted = true

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession()
      if (mounted) setUserEmail(data.session?.user.email ?? null)
    }

    void loadSession()

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserEmail(session?.user.email ?? null)
      }
    )

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadProducts = async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false })

      if (cancelled) return

      if (error) {
        console.error('Failed to load products:', error)
        return
      }

      const mapped: Product[] = (data ?? []).map((product) => ({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        category: product.category ?? 'Uncategorised',
        image: product.image_url ?? '',
        tone: '',
        sizes: ['S', 'M', 'L', 'XL'],
        description: product.description ?? '',
      }))

      setDbProducts(mapped)
    }

    void loadProducts()

    return () => {
      cancelled = true
    }
  }, [])

  const submitAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthLoading(true)
    setAuthMessage('')

    const result = authMode === 'signup'
      ? await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        })
      : await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        })

    setAuthLoading(false)

    if (result.error) {
      console.error('AUREN AUTH ERROR:', result.error)
      setAuthMessage(result.error.message)
      return
    }

    console.log('AUREN AUTH RESULT:', result.data)

    if (authMode === 'signup') {
      setAuthMessage('Account created. Check your email to confirm your address.')
      return
    }

    setAuthMessage('Signed in successfully.')
    setAuthOpen(false)
    setAuthPassword('')
  }

  const startPayment = async () => {
    if (subtotal <= 0 || paymentLoading) return
    setPaymentLoading(true)
    setPaymentMessage('')
    try {
      const { data, error } = await supabase.functions.invoke('create-razorpay-order', { body: { amount: subtotal } })
      if (error || !data?.orderId || !data?.keyId) throw new Error(error?.message || data?.error || 'Unable to start checkout')
      if (!window.Razorpay) throw new Error('Payment checkout is still loading. Please try again.')
      const checkout = new window.Razorpay({
        key: data.keyId, amount: data.amount, currency: data.currency || 'INR', name: 'AUREN',
        description: 'AUREN Studio order', order_id: data.orderId, prefill: userEmail ? { email: userEmail } : undefined,
        theme: { color: '#171614' },
        handler: async (response) => {
          const result = await supabase.functions.invoke('verify-razorpay-payment', { body: response })
          if (result.error || !result.data?.verified) { setPaymentMessage(result.error?.message || result.data?.error || 'Payment could not be verified.'); return }
          setCart([]); setCartOpen(false); setPaymentMessage('Payment successful. Your AUREN order is confirmed.')
        },
      })
      checkout.open()
    } catch (error) {
      console.error('AUREN PAYMENT ERROR:', error)
      setPaymentMessage(error instanceof Error ? error.message : 'Unable to start payment.')
    } finally { setPaymentLoading(false) }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setAuthMessage('')
  }

  const sourceProducts = dbProducts.length > 0 ? dbProducts : products

  const visibleProducts = useMemo(
    () => sourceProducts.filter((p) =>
      (category === 'All' || p.category === category) &&
      `${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase())
    ),
    [query, category, sourceProducts]
  )
  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const addToBag = (product: Product, size = product.sizes[0], qty = 1) => {
    setCart((items) => {
      const existing = items.find((item) => item.id === product.id && item.size === size)
      if (existing) return items.map((item) => item.id === product.id && item.size === size ? { ...item, quantity: item.quantity + qty } : item)
      return [...items, { ...product, size, quantity: qty }]
    })
    setCartOpen(true)
    setSelectedProduct(null)
    setQuantity(1)
    setSelectedSize('')
  }

  const openProduct = (product: Product) => {
    setSelectedProduct(product)
    setSelectedSize(product.sizes[0])
    setQuantity(1)
  }

  const changeQuantity = (id: string | number, size: string, delta: number) => {
    setCart((items) => items
      .map((item) => item.id === id && item.size === size ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item)
      .filter((item) => item.quantity > 0))
  }

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const deliveryTarget = 12000
  const deliveryProgress = Math.min(100, Math.round((subtotal / deliveryTarget) * 100))
  const deliveryRemaining = Math.max(0, deliveryTarget - subtotal)
  const recommendations = products.filter((p) => !cart.some((item) => item.id === p.id)).slice(0, 3)

  return <div className="auren">
    <div className="announcement">COMPLIMENTARY DELIVERY ON ORDERS OVER ₹12,000 <span>·</span> AUTUMN / WINTER 2026</div>
    <header className="site-header">
      <button className="menu-trigger" onClick={() => setMenuOpen(true)} aria-label="Open menu"><i /><i /></button>
      <a className="wordmark" href="#top">AUREN</a>
      <nav className="main-nav" aria-label="Primary"><a href="#shop">Shop</a><a href="#collections">Collections</a><a href="#story">Journal</a><a href="#about">About</a></nav>
      <div className="header-tools"><button onClick={() => setSearchOpen(true)} aria-label="Open search">Search</button><button onClick={() => setAuthOpen(true)} aria-label="Open account">{userEmail ? 'Account' : 'Sign in'}</button><button onClick={() => setCartOpen(true)} aria-label="Open shopping bag">Bag ({cartCount})</button></div>
    </header>

    {menuOpen && <div className="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu"><button className="close" onClick={() => setMenuOpen(false)}>Close</button><div className="mobile-logo">AUREN</div><nav><a href="#shop" onClick={() => setMenuOpen(false)}>Shop</a><a href="#collections" onClick={() => setMenuOpen(false)}>Collections</a><a href="#story" onClick={() => setMenuOpen(false)}>Journal</a><a href="#about" onClick={() => setMenuOpen(false)}>About</a></nav><p>Contemporary essentials, considered carefully.</p></div>}

    {searchOpen && <div className="search-screen" role="dialog" aria-modal="true" aria-label="Search"><div className="search-top"><span>Search AUREN</span><button onClick={() => setSearchOpen(false)}>Close</button></div><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products..." aria-label="Search products"/><p>{query ? `${visibleProducts.length} result${visibleProducts.length === 1 ? '' : 's'}` : 'Try “shirt”, “outerwear” or “essentials”.'}</p><div className="search-results">{query && visibleProducts.map((p) => <button key={p.id} onClick={() => { addToBag(p); setSearchOpen(false) }}>{p.name}<span>{money(p.price)}</span></button>)}</div></div>}

    {authOpen && <div className="search-screen auth-screen" role="dialog" aria-modal="true" aria-label="Account">
      <div className="search-top">
        <span>{userEmail ? "Your AUREN account" : authMode === "signin" ? "Sign in to AUREN" : "Create your AUREN account"}</span>
        <button onClick={() => setAuthOpen(false)}>Close</button>
      </div>

      {userEmail ? (
        <div className="auth-panel">
          <p className="eyebrow">ACCOUNT</p>
          <h2>{userEmail}</h2>
          <p>Your account is ready. Order history and checkout will appear here as we complete the commerce layer.</p>
          <button className="cta cta-dark" onClick={signOut}>Sign out <Arrow /></button>
        </div>
      ) : (
        <form className="auth-panel" onSubmit={submitAuth}>
          <p className="eyebrow">ACCOUNT</p>
          <h2>{authMode === "signin" ? "Welcome back." : "Begin with AUREN."}</h2>
          <p>{authMode === "signin" ? "Sign in to continue." : "Create an account to save your details and orders."}</p>

          <label>
            Email
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={authMode === "signin" ? "current-password" : "new-password"}
            />
          </label>

          {authMessage && <p className="auth-message" role="status">{authMessage}</p>}

          <button className="cta cta-dark" type="submit" disabled={authLoading}>
            {authLoading ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"} <Arrow />
          </button>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setAuthMode(authMode === "signin" ? "signup" : "signin")
              setAuthMessage("")
            }}
          >
            {authMode === "signin" ? "Create an account" : "Already have an account? Sign in"}
          </button>
        </form>
      )}
    </div>}

    {selectedProduct && <div className="product-modal" role="dialog" aria-modal="true" aria-label={selectedProduct.name}>
      <button className="modal-backdrop" onClick={() => setSelectedProduct(null)} aria-label="Close product"></button>
      <article className="product-detail">
        <button className="modal-close" onClick={() => setSelectedProduct(null)}>Close</button>
        <div className="detail-image"><img src={selectedProduct.image} alt={selectedProduct.name}/></div>
        <div className="detail-copy">
          <p className="eyebrow">{selectedProduct.category} · {selectedProduct.tone}</p>
          <h2>{selectedProduct.name}</h2>
          <strong>{money(selectedProduct.price)}</strong>
          <p className="detail-description">{selectedProduct.description}</p>
          <div className="size-picker"><span>Size</span><div>{selectedProduct.sizes.map((size) => <button className={selectedSize === size ? 'selected' : ''} onClick={() => setSelectedSize(size)} key={size}>{size}</button>)}</div></div>
          <div className="quantity-picker"><span>Quantity</span><div><button onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><b>{quantity}</b><button onClick={() => setQuantity(quantity + 1)}>+</button></div></div>
          <button className="detail-add cta cta-dark" onClick={() => addToBag(selectedProduct, selectedSize, quantity)}>Add to bag <Arrow /></button>
          <p className="detail-note">Complimentary delivery over ₹12,000. Easy returns within 14 days.</p>
        </div>
      </article>
    </div>}
    <main id="top">
      <section className="hero"><img src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=2200&q=90" alt="Editorial view of the AUREN autumn winter collection" /><div className="hero-content"><p className="eyebrow">AUTUMN / WINTER 2026</p><h1>Made for the spaces between moments.</h1><p className="hero-lede">Refined essentials designed for modern days, from first light to last plans.</p><a className="cta cta-light" href="#shop">Explore the collection <Arrow /></a></div><div className="hero-meta"><span>01 / 04</span><span>Scroll to discover</span></div></section>

      <section className="manifesto" id="about"><div className="section-label">THE AUREN APPROACH</div><div><h2>We believe the things you live with every day deserve more thought.</h2><p>Quiet forms, considered materials and pieces designed to move naturally through your life.</p></div></section>

      <section className="editorial" id="collections"><div className="section-heading"><div><p className="eyebrow">01 — EDIT</p><h2>New in.</h2></div><a href="#shop">View collection <Arrow /></a></div><div className="editorial-grid"><article><img src="https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&w=1500&q=88" alt="AUREN new collection"/><div><span>THE NEW FORM</span><h3>Designed with restraint.</h3></div></article><article><img src="https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1100&q=88" alt="AUREN essentials"/><div><span>ESSENTIALS</span><h3>Nothing unnecessary.</h3></div></article></div></section>

      <section className="shop-section" id="shop"><div className="section-heading"><div><p className="eyebrow">02 — SHOP</p><h2>Everyday forms.</h2></div><span className="shop-count">{products.length} pieces</span></div><div className="category-filter" aria-label="Filter products">{['All', ...Array.from(new Set(products.map(p => p.category)))].map((item) => <button className={category === item ? 'active' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div><div className="product-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}><button className="product-image" onClick={() => openProduct(product)} aria-label={`View ${product.name}`}><img src={product.image} alt={product.name}/><span>View piece</span></button><div className="product-info"><div><h3>{product.name}</h3><p>{product.category} · {product.tone}</p></div><strong>{money(product.price)}</strong></div></article>)}</div></section>

      <section className="story" id="story"><div className="story-image"><img src="https://images.unsplash.com/photo-1496217590455-aa63a8350eea?auto=format&fit=crop&w=1600&q=88" alt="AUREN studio editorial"/></div><div className="story-copy"><p className="eyebrow">03 — MATERIAL / FORM</p><h2>Less, but better.</h2><p>Every AUREN piece begins with a simple question: what deserves a place in your everyday rotation?</p><p>We answer with considered silhouettes, tactile materials and details that reveal themselves slowly.</p><a href="#about">Read the journal <Arrow /></a></div></section>

      <section className="recommendations shop-section"><div className="section-heading"><div><p className="eyebrow">04 — CONTINUE</p><h2>Consider these.</h2></div></div><div className="product-grid">{recommendations.map((product) => <article className="product-card" key={product.id}><button className="product-image" onClick={() => openProduct(product)} aria-label={`View ${product.name}`}><img src={product.image} alt={product.name}/><span>View piece</span></button><div className="product-info"><div><h3>{product.name}</h3><p>{product.category} · {product.tone}</p></div><strong>{money(product.price)}</strong></div></article>)}</div></section>

      <section className="quote"><p>“The best essentials don't ask for attention. They earn a place in your life.”</p><span>— AUREN STUDIO</span></section>

      <section className="newsletter"><div><p className="eyebrow">STAY IN THE KNOW</p><h2>Notes from AUREN.</h2><p>New collections, studio stories and considered things worth knowing.</p></div><form onSubmit={(e) => { e.preventDefault(); setEmail('') }}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="Your email address" aria-label="Email address"/><button className="cta cta-dark">Subscribe <Arrow /></button></form></section>
    </main>

    <footer><div className="footer-top"><div className="footer-wordmark">AUREN</div><div className="footer-links"><div><b>SHOP</b><a href="#shop">New in</a><a href="#shop">Essentials</a><a href="#shop">Outerwear</a></div><div><b>ABOUT</b><a href="#about">Our story</a><a href="#story">Journal</a><a href="#about">Contact</a></div><div><b>HELP</b><a href="#about">Shipping</a><a href="#about">Returns</a><a href="#about">FAQ</a></div></div></div><div className="footer-bottom"><span>© 2026 AUREN STUDIO</span><span>Fictional portfolio concept</span></div></footer>

    {cartOpen && <><button className="backdrop" onClick={() => setCartOpen(false)} aria-label="Close cart"></button><aside className="cart" aria-label="Shopping bag"><div className="cart-head"><h2>Your bag</h2><button onClick={() => setCartOpen(false)}>Close</button></div>{cart.length === 0 ? <div className="empty-cart"><p>Your bag is currently empty.</p><a href="#shop" onClick={() => setCartOpen(false)}>Explore the collection <Arrow /></a></div> : <><div className="cart-list">{cart.map((item) => <div className="cart-item" key={`${item.id}-${item.size}`}><img src={item.image} alt=""/><div><h3>{item.name}</h3><p>{money(item.price)}</p><small>Size {item.size}</small><div className="cart-qty"><button onClick={() => changeQuantity(item.id, item.size, -1)}>−</button><b>{item.quantity}</b><button onClick={() => changeQuantity(item.id, item.size, 1)}>+</button></div></div></div>)}</div><div className="checkout"><div className="delivery-progress"><span>{deliveryRemaining ? `Add ${money(deliveryRemaining)} for complimentary delivery` : 'Complimentary delivery unlocked'}</span><b>{deliveryProgress}%</b></div><div className="progress-track"><i style={{ width: `${deliveryProgress}%` }} /></div><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><button className="cta cta-dark" onClick={() => void startPayment()} disabled={paymentLoading}>{paymentLoading ? "Opening secure checkout…" : "Proceed to checkout"} <Arrow /></button>{paymentMessage && <small className="payment-message" role="status">{paymentMessage}</small>}<small>Taxes and delivery calculated at checkout.</small></div></>}</aside></>}
  </div>
}

export default App
