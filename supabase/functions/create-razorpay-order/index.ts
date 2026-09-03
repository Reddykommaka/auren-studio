import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function getSecretKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS")

  if (secretKeys) {
    const parsed = JSON.parse(secretKeys)
    if (parsed.default) return parsed.default
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const authorization = req.headers.get("Authorization")

    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication required" }, 401)
    }

    const token = authorization.slice(7)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseKey = getSecretKey()
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID")
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET")

    if (!supabaseUrl || !supabaseKey || !razorpayKeyId || !razorpayKeySecret) {
      throw new Error("Required server configuration is missing")
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return jsonResponse({ error: "Authentication required" }, 401)
    }

    const body = await req.json()
    const items = body?.items

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return jsonResponse({ error: "Invalid cart" }, 400)
    }

    const normalizedItems = items.map((item) => ({
      product_id: item?.product_id,
      quantity: item?.quantity,
      size: typeof item?.size === "string" ? item.size.slice(0, 32) : null,
    }))

    if (normalizedItems.some((item) =>
      !isUuid(item.product_id) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99
    )) {
      return jsonResponse({ error: "Invalid cart item" }, 400)
    }

    const productIds = [...new Set(
      normalizedItems.map((item) => item.product_id),
    )]

    const { data: products, error: productsError } = await supabaseAdmin
      .from("products")
      .select("id,name,price,currency,inventory,active")
      .in("id", productIds)
      .eq("active", true)

    if (productsError) {
      throw productsError
    }

    if (!products || products.length !== productIds.length) {
      return jsonResponse({ error: "One or more products are unavailable" }, 409)
    }

    const productMap = new Map(
      products.map((product) => [product.id, product]),
    )

    let subtotal = 0

    const orderItems = normalizedItems.map((item) => {
      const product = productMap.get(item.product_id)!

      if (product.inventory < item.quantity) {
        throw new Error(`${product.name} does not have enough inventory`)
      }

      const unitPrice = Number(product.price)

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("Invalid product price")
      }

      subtotal += unitPrice * item.quantity

      return {
        product_id: product.id,
        product_name: product.name,
        unit_price: unitPrice,
        quantity: item.quantity,
        size: item.size,
      }
    })

    subtotal = Math.round(subtotal * 100) / 100

    if (subtotal <= 0) {
      return jsonResponse({ error: "Invalid order total" }, 400)
    }

    const shipping = 0
    const tax = 0
    const total = subtotal + shipping + tax
    const amountInPaise = Math.round(total * 100)

    const { data: aurenOrder, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        status: "pending",
        payment_status: "pending",
        payment_provider: "razorpay",
        payment_reference: null,
        subtotal,
        shipping,
        tax,
        total,
        currency: "INR",
      })
      .select("id")
      .single()

    if (orderError || !aurenOrder) {
      throw orderError ?? new Error("Unable to create order")
    }

    const { error: itemsError } = await supabaseAdmin
      .from("order_items")
      .insert(
        orderItems.map((item) => ({
          ...item,
          order_id: aurenOrder.id,
        })),
      )

    if (itemsError) {
      await supabaseAdmin
        .from("orders")
        .delete()
        .eq("id", aurenOrder.id)

      throw itemsError
    }

    const auth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`)

    const razorpayResponse = await fetch(
      "https://api.razorpay.com/v1/orders",
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: "INR",
          receipt: `aur_${aurenOrder.id.replaceAll("-", "").slice(0, 28)}`,
        }),
      },
    )

    const razorpayData = await razorpayResponse.json()

    if (!razorpayResponse.ok) {
      await supabaseAdmin
        .from("orders")
        .update({
          status: "cancelled",
          payment_status: "failed",
        })
        .eq("id", aurenOrder.id)

      return jsonResponse(
        { error: "Unable to create Razorpay order" },
        razorpayResponse.status >= 500 ? 502 : 400,
      )
    }

    const { error: linkError } = await supabaseAdmin
      .from("orders")
      .update({
        payment_reference: razorpayData.id,
      })
      .eq("id", aurenOrder.id)

    if (linkError) {
      throw linkError
    }

    return jsonResponse({
      aurenOrderId: aurenOrder.id,
      orderId: razorpayData.id,
      amount: razorpayData.amount,
      currency: razorpayData.currency,
      keyId: razorpayKeyId,
    })
  } catch (error) {
    console.error("AUREN order creation error:", error)

    return jsonResponse(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to create order",
      },
      400,
    )
  }
})
