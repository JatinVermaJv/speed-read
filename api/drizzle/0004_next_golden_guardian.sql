CREATE TABLE "book_ai_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"kind" varchar(60) NOT NULL,
	"payload" text NOT NULL,
	"model" varchar(120) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"author" varchar(255) NOT NULL,
	"status" varchar(30) DEFAULT 'to_read' NOT NULL,
	"rating" integer,
	"notes" text,
	"google_volume_id" varchar(120),
	"cover_image_url" text,
	"description" text,
	"categories" text,
	"published_date" varchar(40),
	"page_count" integer,
	"publisher" varchar(255),
	"language" varchar(20),
	"preview_link" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_ai_outputs" ADD CONSTRAINT "book_ai_outputs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_ai_outputs" ADD CONSTRAINT "book_ai_outputs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_ai_outputs_book_kind_unique" ON "book_ai_outputs" USING btree ("book_id","kind");