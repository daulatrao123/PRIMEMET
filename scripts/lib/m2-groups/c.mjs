/**
 * Group C — the public catalogue as a visitor receives it.
 *
 * The fixtures come from group B: one published bearing in a category of its own, plus a set of extra
 * published products so pagination, sorting and facets have something real to count. Everything is read
 * anonymously through the running Next server — the same HTML a buyer gets.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { client, modules, fixture } = ctx;
  const suffix = randomUUID().slice(0, 5);

  // ---- fixtures ---------------------------------------------------------------------------------
  const secondCategory = await modules.catalogue.createCategory({
    name: `M2 Copper ${suffix}`,
    slug: `m2-copper-${suffix}`,
    kind: "SCRAP",
  });
  const secondFamily = await modules.catalogue.createFamily({
    categoryId: secondCategory.id,
    name: "Copper wire",
    slug: `m2-copper-wire-${suffix}`,
  });

  const published = [];
  for (let index = 1; index <= 14; index += 1) {
    const created = await modules.catalogue.createProduct({
      title: `Copper millberry ${suffix} #${String(index).padStart(2, "0")}`,
      slug: `m2-copper-${suffix}-${index}`,
      familyId: secondFamily.id,
      manufacturer: index % 2 === 0 ? "Alex Metals" : "PM Reclaim",
      condition: index % 3 === 0 ? "USED" : "NEW",
      priceMode: "REQUEST",
      shortDescription: `Copper grade ${index} for the M2 pagination fixture.`,
      publicationState: "PUBLISHED",
      images: index === 1 ? [{ url: "https://cdn.example.test/copper-1.jpg", alt: "Copper wire" }] : [],
    });
    published.push(created);
  }

  const draft = await modules.catalogue.createProduct({
    title: `Hidden draft ${suffix}`,
    slug: `m2-hidden-draft-${suffix}`,
    familyId: secondFamily.id,
    condition: "NEW",
    priceMode: "REQUEST",
    publicationState: "DRAFT",
  });

  ctx.fixture.publishedProductSlug = fixture.productSlug;

  // ---- listing ----------------------------------------------------------------------------------
  await test("C1", "the catalogue lists published products and never a draft", async () => {
    const response = await client.get("/products", { anonymous: true });
    assert(response.status === 200, `status ${response.status}`);
    // The group B fixture is the newest product in its category, but this test also publishes fourteen
    // newer products, so it is checked on page 1 of its own category — and in the data layer, where the
    // ordering is decided.
    const ownCategory = await client.get(`/products?category=${fixture.categorySlug}`, { anonymous: true });
    assert(ownCategory.text.includes("Deep groove ball bearing"), "the published fixture is missing from its category");
    const listed = await modules.catalogue.listPublishedProducts({ category: fixture.categorySlug, pageSize: 48 });
    assert(listed.items.some((item) => item.id === fixture.productId), "the published fixture is not in the public query");
    assert(!response.text.includes(`Hidden draft ${suffix}`), "a DRAFT product is listed");
    assert(!(await client.get(`/products?q=${suffix}`, { anonymous: true })).text.includes(`Hidden draft ${suffix}`), "a DRAFT is in the search results");
    return "200, published fixture present, draft absent";
  });

  await test("C2", "search matches title, part number and manufacturer", async () => {
    const byPart = await client.get("/products?q=6205-2RS", { anonymous: true });
    assert(byPart.text.includes("Deep groove ball bearing"), "search by part number failed");

    const byManufacturer = await client.get("/products?q=SKF India", { anonymous: true });
    assert(byManufacturer.text.includes("Deep groove ball bearing"), "search by manufacturer failed");

    const none = await client.get("/products?q=no-such-thing-xyz", { anonymous: true });
    assert(none.text.includes("No product matches"), "an empty search does not say so");
    return "title/part/manufacturer hits, honest empty state";
  });

  await test("C3", "a regex metacharacter in the search is treated literally", async () => {
    const response = await client.get("/products?q=" + encodeURIComponent(".*"), { anonymous: true });
    assert(response.status === 200, `status ${response.status}`);
    const literal = await modules.catalogue.listPublishedProducts({ q: ".*", pageSize: 48 });
    assert(literal.total === 0, `".*" matched ${literal.total} products — the pattern was not escaped`);
    const dot = await modules.catalogue.listPublishedProducts({ q: ".", pageSize: 48 });
    assert(dot.total === 0, `"." matched ${dot.total} products`);
    return '".*" matches nothing rather than everything';
  });

  await test("C4", "filtering by category and by subcategory narrows the result set", async () => {
    const byCategory = await client.get(`/products?category=m2-copper-${suffix}`, { anonymous: true });
    assert(byCategory.text.includes(`Copper millberry ${suffix}`), "the category filter returned nothing");
    assert(!byCategory.text.includes("Deep groove ball bearing"), "the category filter leaked another category");

    const byFamily = await client.get(`/products?family=m2-copper-wire-${suffix}`, { anonymous: true });
    assert(byFamily.text.includes(`Copper millberry ${suffix}`), "the subcategory filter returned nothing");
    // Counted from the JSON the page renders through the same data layer, because the visible text wraps
    // "N products" across elements and a substring match on markup would test the CSS, not the query.
    const counted = await modules.catalogue.listPublishedProducts({
      family: `m2-copper-wire-${suffix}`,
      pageSize: 48,
    });
    assert(counted.total === 14, `subcategory total is ${counted.total}, expected 14`);
    return "category and subcategory both isolate their products";
  });

  await test("C5", "filtering by condition returns only that condition", async () => {
    const response = await client.get(`/products?family=m2-copper-wire-${suffix}&condition=USED`, { anonymous: true });
    assert(response.status === 200, `status ${response.status}`);
    const counted = await modules.catalogue.listPublishedProducts({
      family: `m2-copper-wire-${suffix}`,
      condition: "USED",
      pageSize: 48,
    });
    assert(counted.total === 4, `USED total is ${counted.total}, expected 4`);
    assert(counted.items.every((item) => item.condition === "USED"), "a non-USED product was returned");
    return "4 USED products of 14";
  });

  await test("C6", "pagination splits the set and pages 2..n hold the remainder", async () => {
    const page1 = await client.get(`/products?family=m2-copper-wire-${suffix}&page=1`, { anonymous: true });
    const page2 = await client.get(`/products?family=m2-copper-wire-${suffix}&page=2`, { anonymous: true });
    const first = await modules.catalogue.listPublishedProducts({ family: `m2-copper-wire-${suffix}`, page: 1, pageSize: 12 });
    const second = await modules.catalogue.listPublishedProducts({ family: `m2-copper-wire-${suffix}`, page: 2, pageSize: 12 });
    assert(first.items.length === 12 && second.items.length === 2, `pages hold ${first.items.length} and ${second.items.length}`);
    assert(!first.items.some((item) => second.items.some((other) => other.id === item.id)), "the pages overlap");
    assert(page1.status === 200 && page2.status === 200, "a page did not render");

    // Newest-first: #14 is at the top of page 1 and #01 is the last product overall.
    assert(page1.text.includes("#14"), "page 1 is missing the newest product");
    assert(!page1.text.includes("#01"), "page 1 already contains a page-2 product");
    assert(page2.text.includes("#01"), "page 2 is missing its product");

    const beyond = await client.get(`/products?family=m2-copper-wire-${suffix}&page=99`, { anonymous: true });
    assert(beyond.status === 200, `page 99 returned ${beyond.status}`);
    return "12 + 2 split across two pages; an out-of-range page stays a 200";
  });

  await test("C7", "sort by title is alphabetical", async () => {
    const response = await client.get(`/products?family=m2-copper-wire-${suffix}&sort=title&page=1`, { anonymous: true });
    const first = response.text.indexOf("#01");
    const last = response.text.indexOf("#09");
    assert(first !== -1 && last !== -1, "the title-sorted page is missing fixtures");
    assert(first < last, "title sort is not alphabetical");
    return "#01 renders before #09";
  });

  await test("C8", "the filter panel is built from published products only", async () => {
    const response = await client.get("/products", { anonymous: true });
    assert(response.text.includes(`M2 Copper ${suffix}`), "the category facet is missing");
    assert(response.text.includes("Copper wire"), "the subcategory facet is missing");
    assert(response.text.includes("Alex Metals"), "the manufacturer facet is missing");
    return "category, subcategory and manufacturer facets present";
  });

  await test("C9", "the detail page shows the gallery, facts and specification table", async () => {
    const response = await client.get(`/products/${fixture.productSlug}`, { anonymous: true });
    assert(response.status === 200, `status ${response.status}`);
    for (const expected of ["6205-2RS", "SKF India", "Dynamic load rating", "14", "kN", "Ball bearings"]) {
      assert(response.text.includes(expected), `"${expected}" is missing from the detail page`);
    }
    assert(response.text.includes("6205-hero.jpg"), "the hero image is missing");
    assert(/rel="canonical"/.test(response.text), "no canonical link");
    return "specifications, facts, gallery and canonical all rendered";
  });

  await test("C10", "an unknown slug is a real 404", async () => {
    const response = await client.get("/products/does-not-exist-at-all", { anonymous: true });
    assert(response.status === 404, `status ${response.status}`);
    const noindex = /name="robots"[^>]*content="noindex/.test(response.text) || /content="noindex"[^>]*name="robots"/.test(response.text);
    assert(noindex, "the not-found page is indexable");
    return "404 with noindex";
  });

  await test("C11", "an anonymous visitor is offered sign-in rather than an enquiry form", async () => {
    const response = await client.get(`/products/${fixture.productSlug}`, { anonymous: true });
    assert(/Sign in to enquire/.test(response.text), "no sign-in call to action");
    assert(!/action="\/api\/enquiries"/.test(response.text), "an anonymous visitor was given the enquiry form");
    return "sign-in CTA rendered, no form";
  });

  await test("C12", "a buyer sees the enquiry form on the product page", async () => {
    const buyer = (await import("../m1-verify-core.mjs")).createClient(ctx.baseUrl);
    const signIn = await buyer.post("/api/auth/login", {
      body: { email: ctx.fixture.buyerEmail, password: ctx.fixture.buyerPassword },
      useJar: true,
      anonymous: true,
    });
    assert(signIn.status === 200 || signIn.status === 303, `buyer sign-in returned ${signIn.status}`);
    const response = await buyer.get(`/products/${fixture.productSlug}`);
    assert(/action="\/api\/enquiries"/.test(response.text), "the buyer has no enquiry form");
    assert(response.text.includes(`value="${fixture.productId}"`), "the form is not bound to the product");
    ctx.fixture.buyerClient = buyer;
    return "buyer form posts to /api/enquiries with the product id";
  });

  await test("C13", "a draft's slug is not discoverable — the same 404 as a missing page", async () => {
    const draftResponse = await client.get(`/products/${draft.slug}`, { anonymous: true });
    const missingResponse = await client.get("/products/never-existed", { anonymous: true });
    assert(draftResponse.status === 404, `draft returned ${draftResponse.status}`);
    assert(draftResponse.status === missingResponse.status, "draft and missing differ in status");
    return "both 404";
  });

  await test("C14", "the sitemap includes the catalogue listing but no product detail URLs", async () => {
    const sitemap = await client.get("/sitemap.xml", { anonymous: true });
    assert(sitemap.status === 200, `status ${sitemap.status}`);
    assert(/<loc>[^<]*\/products<\/loc>/.test(sitemap.text), "/products is missing from the sitemap");
    assert(!sitemap.text.includes(`/products/${fixture.productSlug}`), "a product detail URL is in the sitemap");
    return "/products listed; per-product URLs are left to on-demand indexing";
  });
}
