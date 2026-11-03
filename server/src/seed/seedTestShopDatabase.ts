import { ObjectId, type Db } from "mongodb";

const FIRST_NAMES = ["Aarav", "Diya", "Rahul", "Priya", "Kabir", "Ananya", "Vikram", "Meera", "Rohan", "Isha"];
const LAST_NAMES = ["Patel", "Shah", "Mehta", "Desai", "Joshi", "Khan", "Iyer", "Nair", "Reddy", "Gupta"];
const CITIES = ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Mumbai"];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

export async function seedTestShopDatabase(db: Db): Promise<{
  database: string;
  shops: number;
  products: number;
  customers: number;
  orders: number;
}> {
  const shopsCol = db.collection("shops");
  const productsCol = db.collection("products");
  const customersCol = db.collection("customers");
  const ordersCol = db.collection("orders");

  await Promise.all([
    shopsCol.drop().catch(() => undefined),
    productsCol.drop().catch(() => undefined),
    customersCol.drop().catch(() => undefined),
    ordersCol.drop().catch(() => undefined)
  ]);

  const shops = [
    { _id: new ObjectId(), name: "Ahmedabad Shop", city: "Ahmedabad", openedAt: daysAgo(400) },
    { _id: new ObjectId(), name: "Surat Shop", city: "Surat", openedAt: daysAgo(280) }
  ];

  const products = [
    { _id: new ObjectId(), name: "Laptop", sku: "LAP-100", category: "computers", purchasePrice: 42000, sellingPrice: 52000 },
    { _id: new ObjectId(), name: "Mouse", sku: "MOU-200", category: "accessories", purchasePrice: 350, sellingPrice: 599 },
    { _id: new ObjectId(), name: "Keyboard", sku: "KEY-300", category: "accessories", purchasePrice: 900, sellingPrice: 1499 },
    { _id: new ObjectId(), name: "Monitor", sku: "MON-400", category: "computers", purchasePrice: 8500, sellingPrice: 11999 }
  ];

  const customers = Array.from({ length: 24 }, (_, i) => ({
    _id: new ObjectId(),
    name: `${pick(FIRST_NAMES, i)} ${pick(LAST_NAMES, i + 3)}`,
    city: pick(CITIES, i),
    email: `customer${i + 1}@example.test`,
    createdAt: daysAgo(90 - (i % 80))
  }));

  const orders: Record<string, unknown>[] = [];
  let seq = 0;
  for (let day = 0; day < 90; day += 1) {
    const ordersToday = 1 + (day % 4);
    for (let n = 0; n < ordersToday; n += 1) {
      const product = pick(products, seq + n);
      const shop = pick(shops, seq);
      const customer = pick(customers, seq + day);
      const quantity = 1 + (seq % 4);
      orders.push({
        _id: new ObjectId(),
        shopId: shop._id,
        productId: product._id,
        customerId: customer._id,
        quantity,
        sellingPrice: product.sellingPrice,
        purchasePrice: product.purchasePrice,
        createdAt: daysAgo(day),
        status: seq % 17 === 0 ? "cancelled" : "completed"
      });
      seq += 1;
    }
  }

  await shopsCol.insertMany(shops);
  await productsCol.insertMany(products);
  await customersCol.insertMany(customers);
  await ordersCol.insertMany(orders);

  await ordersCol.createIndex({ createdAt: 1 });
  await ordersCol.createIndex({ shopId: 1 });
  await ordersCol.createIndex({ productId: 1 });
  await ordersCol.createIndex({ customerId: 1 });

  return {
    database: db.databaseName,
    shops: shops.length,
    products: products.length,
    customers: customers.length,
    orders: orders.length
  };
}
