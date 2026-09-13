import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { z } from "zod";
import { Actor, AuthService, Current, Public, Roles } from "./auth";
import { CatalogService } from "./catalog";
import { Db } from "./db";
import {
  actionSchema,
  assignSchema,
  availabilitySchema,
  changePasswordSchema,
  completeSchema,
  createOrderSchema,
  createProductSchema,
  editProductSchema,
  editPromotionSchema,
  editUserSchema,
  ensure,
  listSchema,
  loginSchema,
  paymentSchema,
  productId,
  promotionSchema,
  quoteSchema,
  reasonSchema,
  registerSchema,
  slugSchema,
  staffSchema,
  storeSchema,
  uuid,
} from "./domain";
import { BodyDoc, Mutation } from "./http";
import { OrdersService } from "./orders";
import { StaffService } from "./staff";
import { keySchema } from "./writes";

@Controller()
@ApiBearerAuth()
export class ApiController {
  constructor(
    private readonly auth: AuthService,
    private readonly catalogService: CatalogService,
    private readonly orders: OrdersService,
    private readonly staff: StaffService,
    private readonly db: Db,
  ) {}

  @Get("health")
  @Public()
  @ApiTags("Sistema")
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: "ok", version: "0.1.0" };
  }

  @Post("sessions")
  @HttpCode(200)
  @Public()
  @BodyDoc(loginSchema)
  @ApiTags("Sessão")
  login(@Body() body: unknown) {
    return this.auth.login(loginSchema.parse(body));
  }

  @Post("customers")
  @Public()
  @BodyDoc(registerSchema)
  @ApiTags("Sessão")
  register(@Body() body: unknown) {
    return this.auth.register(registerSchema.parse(body));
  }

  @Delete("sessions/current")
  @Roles("MANAGER", "ATTENDANT", "KITCHEN", "DRIVER", "CUSTOMER")
  @ApiTags("Sessão")
  logout(@Current() actor: Actor) {
    return this.auth.logout(actor);
  }

  @Get("me")
  @Roles("MANAGER", "ATTENDANT", "KITCHEN", "DRIVER", "CUSTOMER")
  @ApiTags("Sessão")
  me(@Current() actor: Actor) {
    return this.staff.me(actor);
  }

  @Post("me/password")
  @HttpCode(200)
  @Roles("MANAGER", "ATTENDANT", "KITCHEN", "DRIVER", "CUSTOMER")
  @BodyDoc(changePasswordSchema)
  @ApiTags("Sessão")
  password(@Current() actor: Actor, @Body() body: unknown) {
    const input = changePasswordSchema.parse(body);
    return this.auth.changePassword(
      actor,
      input.currentPassword,
      input.newPassword,
    );
  }

  @Get("stores/:slug/catalog")
  @Public()
  @ApiTags("Cardápio")
  catalog(@Param("slug") slug: string) {
    return this.catalogService.catalog(slugSchema.parse(slug));
  }

  @Get("stores/:slug/images/:id")
  @Public()
  @ApiTags("Cardápio")
  async image(
    @Param("slug") slug: string,
    @Param("id") id: string,
    @Headers("if-none-match") etag: string | undefined,
    @Res() res: Response,
  ) {
    const image = await this.catalogService.image(
      slugSchema.parse(slug),
      uuid.parse(id),
    );
    const tag = `"${image.digest}"`;
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("ETag", tag);
    if (etag === tag) return res.status(304).end();
    return res.type("image/webp").send(Buffer.from(image.bytes));
  }

  @Get("staff/catalog")
  @Roles("MANAGER", "ATTENDANT")
  @ApiTags("Gestão do cardápio")
  staffCatalog(@Current() actor: Actor) {
    return this.catalogService.staffCatalog(actor);
  }

  @Post("staff/products")
  @Roles("MANAGER")
  @BodyDoc(createProductSchema)
  @Mutation()
  @ApiTags("Gestão do cardápio")
  addProduct(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.catalogService.saveProduct(
      actor,
      keySchema.parse(key),
      createProductSchema.parse(body),
    );
  }

  @Patch("staff/products/:id")
  @Roles("MANAGER")
  @BodyDoc(editProductSchema)
  @Mutation()
  @ApiTags("Gestão do cardápio")
  editProduct(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.catalogService.saveProduct(
      actor,
      keySchema.parse(key),
      editProductSchema.parse(body),
      productId.parse(id),
    );
  }

  @Post("staff/product-images")
  @Roles("MANAGER")
  @Mutation()
  @ApiTags("Gestão do cardápio")
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  async upload(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    keySchema.parse(key);
    ensure(
      file?.buffer,
      "INVALID_IMAGE",
      "Envie uma imagem no campo file.",
      400,
    );
    await this.auth.rate(`image:${actor.id}`, 20, 60);
    return this.catalogService.uploadImage(actor, key, file.buffer);
  }

  @Get("staff/promotions")
  @Roles("MANAGER", "ATTENDANT")
  @ApiTags("Promoções")
  promotions(@Current() actor: Actor) {
    return this.catalogService.promotions(actor);
  }

  @Post("staff/promotions")
  @Roles("MANAGER")
  @BodyDoc(promotionSchema)
  @Mutation()
  @ApiTags("Promoções")
  addPromotion(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.catalogService.savePromotion(
      actor,
      keySchema.parse(key),
      promotionSchema.parse(body),
    );
  }

  @Patch("staff/promotions/:id")
  @Roles("MANAGER")
  @BodyDoc(editPromotionSchema)
  @Mutation()
  @ApiTags("Promoções")
  editPromotion(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.catalogService.savePromotion(
      actor,
      keySchema.parse(key),
      editPromotionSchema.parse(body),
      uuid.parse(id),
    );
  }

  @Patch("staff/store")
  @Roles("MANAGER")
  @BodyDoc(storeSchema)
  @Mutation()
  @ApiTags("Loja")
  editStore(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.catalogService.saveStore(
      actor,
      keySchema.parse(key),
      storeSchema.parse(body),
    );
  }

  @Get("staff/users")
  @Roles("MANAGER")
  @ApiTags("Equipe")
  users(@Current() actor: Actor) {
    return this.staff.users(actor);
  }

  @Post("staff/users")
  @Roles("MANAGER")
  @BodyDoc(staffSchema)
  @Mutation()
  @ApiTags("Equipe")
  addUser(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.staff.create(
      actor,
      keySchema.parse(key),
      staffSchema.parse(body),
    );
  }

  @Patch("staff/users/:id")
  @Roles("MANAGER")
  @BodyDoc(editUserSchema)
  @Mutation()
  @ApiTags("Equipe")
  editUser(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.staff.edit(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      editUserSchema.parse(body),
    );
  }

  @Get("staff/drivers")
  @Roles("MANAGER", "ATTENDANT")
  @ApiTags("Equipe")
  drivers(@Current() actor: Actor) {
    return this.staff.drivers(actor);
  }

  @Patch("staff/drivers/:id/availability")
  @Roles("MANAGER")
  @BodyDoc(availabilitySchema)
  @Mutation()
  @ApiTags("Equipe")
  driverAvailability(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.staff.availability(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      availabilitySchema.parse(body),
    );
  }

  @Patch("driver/availability")
  @Roles("DRIVER")
  @BodyDoc(availabilitySchema)
  @Mutation()
  @ApiTags("Entregador")
  availability(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.staff.availability(
      actor,
      keySchema.parse(key),
      actor.id,
      availabilitySchema.parse(body),
    );
  }

  @Post("orders/quote")
  @Roles("CUSTOMER", "MANAGER", "ATTENDANT")
  @BodyDoc(quoteSchema)
  @Mutation()
  @ApiTags("Pedidos")
  quote(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.quote(
      actor,
      keySchema.parse(key),
      quoteSchema.parse(body),
    );
  }

  @Post("orders")
  @Roles("CUSTOMER")
  @BodyDoc(createOrderSchema)
  @Mutation()
  @ApiTags("Pedidos")
  create(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.create(
      actor,
      keySchema.parse(key),
      createOrderSchema.parse(body).quoteId,
    );
  }

  @Post("staff/orders")
  @Roles("MANAGER", "ATTENDANT")
  @BodyDoc(createOrderSchema)
  @Mutation()
  @ApiTags("Pedidos")
  manual(
    @Current() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.create(
      actor,
      keySchema.parse(key),
      createOrderSchema.parse(body).quoteId,
    );
  }

  @Get("me/orders")
  @Roles("CUSTOMER")
  @ApiTags("Pedidos")
  ownOrders(@Current() actor: Actor, @Query() query: unknown) {
    return this.orders.list(actor, listSchema.parse(query));
  }

  @Get("orders/:id")
  @Roles("CUSTOMER")
  @ApiTags("Pedidos")
  ownOrder(@Current() actor: Actor, @Param("id") id: string) {
    return this.orders.get(actor, uuid.parse(id));
  }

  @Get("staff/orders")
  @Roles("MANAGER", "ATTENDANT", "KITCHEN")
  @ApiTags("Pedidos")
  staffOrders(@Current() actor: Actor, @Query() query: unknown) {
    return this.orders.list(actor, listSchema.parse(query));
  }

  @Get("staff/orders/:id")
  @Roles("MANAGER", "ATTENDANT", "KITCHEN")
  @ApiTags("Pedidos")
  staffOrder(@Current() actor: Actor, @Param("id") id: string) {
    return this.orders.get(actor, uuid.parse(id));
  }

  @Get("driver/deliveries")
  @Roles("DRIVER")
  @ApiTags("Entregador")
  deliveries(@Current() actor: Actor, @Query() query: unknown) {
    return this.orders.list(actor, listSchema.parse(query));
  }

  @Get("driver/deliveries/:id")
  @Roles("DRIVER")
  @ApiTags("Entregador")
  delivery(@Current() actor: Actor, @Param("id") id: string) {
    return this.orders.get(actor, uuid.parse(id));
  }

  @Post("staff/orders/:id/accept")
  @HttpCode(200)
  @Roles("MANAGER", "ATTENDANT")
  @BodyDoc(actionSchema)
  @Mutation()
  @ApiTags("Pedidos")
  staffAccept(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "accept",
      actionSchema.parse(body),
    );
  }

  @Post("staff/orders/:id/prepare")
  @HttpCode(200)
  @Roles("MANAGER", "KITCHEN")
  @BodyDoc(actionSchema)
  @Mutation()
  @ApiTags("Pedidos")
  staffPrepare(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "prepare",
      actionSchema.parse(body),
    );
  }

  @Post("staff/orders/:id/ready")
  @HttpCode(200)
  @Roles("MANAGER", "KITCHEN")
  @BodyDoc(actionSchema)
  @Mutation()
  @ApiTags("Pedidos")
  staffReady(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "ready",
      actionSchema.parse(body),
    );
  }

  @Post("staff/orders/:id/cancel")
  @HttpCode(200)
  @Roles("MANAGER")
  @BodyDoc(reasonSchema)
  @Mutation()
  @ApiTags("Pedidos")
  staffCancel(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "cancel",
      reasonSchema.parse(body),
    );
  }

  @Post("staff/orders/:id/assign")
  @HttpCode(200)
  @Roles("MANAGER", "ATTENDANT")
  @BodyDoc(assignSchema)
  @Mutation()
  @ApiTags("Pedidos")
  staffAssign(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "assign",
      assignSchema.parse(body),
    );
  }

  @Post("staff/orders/:id/pickup-complete")
  @HttpCode(200)
  @Roles("MANAGER", "ATTENDANT")
  @BodyDoc(completeSchema)
  @Mutation()
  @ApiTags("Pedidos")
  staffPickupComplete(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "pickup-complete",
      completeSchema.parse(body),
    );
  }

  @Post("staff/orders/:id/return")
  @HttpCode(200)
  @Roles("MANAGER", "ATTENDANT")
  @BodyDoc(actionSchema)
  @Mutation()
  @ApiTags("Pedidos")
  staffReturn(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "return",
      actionSchema.parse(body),
    );
  }

  @Post("staff/orders/:id/record-payment")
  @HttpCode(200)
  @Roles("MANAGER")
  @BodyDoc(paymentSchema)
  @Mutation()
  @ApiTags("Pedidos")
  staffRecordPayment(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "record-payment",
      paymentSchema.parse(body),
    );
  }

  @Post("orders/:id/cancel")
  @HttpCode(200)
  @Roles("CUSTOMER")
  @BodyDoc(reasonSchema)
  @Mutation()
  @ApiTags("Pedidos")
  customerCancel(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "cancel",
      reasonSchema.parse(body),
    );
  }

  @Post("driver/deliveries/:id/collect")
  @HttpCode(200)
  @Roles("DRIVER")
  @BodyDoc(actionSchema)
  @Mutation()
  @ApiTags("Entregador")
  driverCollect(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "collect",
      actionSchema.parse(body),
    );
  }

  @Post("driver/deliveries/:id/start")
  @HttpCode(200)
  @Roles("DRIVER")
  @BodyDoc(actionSchema)
  @Mutation()
  @ApiTags("Entregador")
  driverStart(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "start",
      actionSchema.parse(body),
    );
  }

  @Post("driver/deliveries/:id/complete")
  @HttpCode(200)
  @Roles("DRIVER")
  @BodyDoc(completeSchema)
  @Mutation()
  @ApiTags("Entregador")
  driverComplete(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "complete",
      completeSchema.parse(body),
    );
  }

  @Post("driver/deliveries/:id/issue")
  @HttpCode(200)
  @Roles("DRIVER")
  @BodyDoc(reasonSchema)
  @Mutation()
  @ApiTags("Entregador")
  driverIssue(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "issue",
      reasonSchema.parse(body),
    );
  }

  @Post("driver/deliveries/:id/return")
  @HttpCode(200)
  @Roles("DRIVER")
  @BodyDoc(actionSchema)
  @Mutation()
  @ApiTags("Entregador")
  driverReturn(
    @Current() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.orders.command(
      actor,
      keySchema.parse(key),
      uuid.parse(id),
      "return",
      actionSchema.parse(body),
    );
  }
}

export const contractSchemas: Record<string, z.ZodType> = {
  QuoteRequest: quoteSchema,
  Product: createProductSchema,
  Promotion: promotionSchema,
  Action: actionSchema,
  Complete: completeSchema,
};
