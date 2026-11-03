import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlugZap } from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { useConnect } from "@/hooks/useMongo";
import { api } from "@/lib/api";
import { ApiError } from "@/types/api";
import type { ClientEngine } from "@/lib/engines";

const schema = z.object({
  engine: z.enum(["mongodb", "mysql", "mssql"]),
  name: z.string().optional(),
  connectionString: z.string().optional(),
  host: z.string().optional(),
  port: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  databaseName: z.string().optional()
});

type DbEngine = Exclude<ClientEngine, "quickbooks" | "outlook">;

export function ConnectionForm() {
  const connect = useConnect();
  const [engine, setEngine] = useState<DbEngine>("mongodb");
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      engine: "mongodb",
      name: "",
      connectionString: "",
      host: "46.202.160.23",
      port: "3306",
      username: "root",
      password: "",
      databaseName: ""
    }
  });

  return (
    <form
      className="space-y-2.5"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          const status = await connect.mutateAsync(
            values.engine === "mssql"
              ? {
                  engine: "mssql",
                  connectionString: values.connectionString?.trim(),
                  password: values.password ?? "",
                  databaseName: values.databaseName?.trim() || undefined,
                  name: values.name?.trim() || undefined
                }
              : values.engine === "mysql"
                ? {
                    engine: "mysql",
                    host: values.host?.trim(),
                    port: values.port ? Number.parseInt(values.port, 10) : 3306,
                    username: values.username?.trim() || "root",
                    password: values.password ?? "",
                    databaseName: values.databaseName?.trim() || undefined,
                    name: values.name?.trim() || undefined,
                    ssl: true
                  }
                : {
                    engine: "mongodb",
                    connectionString: values.connectionString ?? "",
                    name: values.name?.trim() || undefined,
                    databaseName: values.databaseName?.trim() || undefined
                  }
          );
          form.reset({
            ...form.getValues(),
            name: "",
            connectionString: "",
            password: ""
          });
          if (status.needsDatabaseSelection) {
            toast.message("Connected. Select a database to continue.");
          } else {
            toast.success(`Saved and connected to ${status.connectionName ?? status.database ?? values.engine}`);
          }
        } catch (error) {
          const err = error instanceof ApiError ? error : new ApiError("Unable to connect.");
          toast.error(err.message, { description: err.hints.join(" · ") });
        }
      })}
    >
      <label className="block text-xs font-medium">Database type</label>
      <Select
        value={engine}
        onChange={(e) => {
          const next = e.target.value as DbEngine;
          setEngine(next);
          form.setValue("engine", next);
        }}
      >
        <option value="mongodb">MongoDB</option>
        <option value="mysql">MySQL</option>
        <option value="mssql">SQL Server / Azure SQL</option>
      </Select>
      <label className="block text-xs font-medium">Nickname (optional)</label>
      <Input placeholder="Shop / MedPACS" autoComplete="off" {...form.register("name")} />
      {engine === "mongodb" ? (
        <>
          <label className="block text-xs font-medium">Connection string</label>
          <Input
            placeholder="mongodb+srv://user:password@cluster.mongodb.net/mydb"
            autoComplete="off"
            spellCheck={false}
            {...form.register("connectionString")}
          />
        </>
      ) : engine === "mssql" ? (
        <>
          <label className="block text-xs font-medium">Connection string</label>
          <Textarea
            rows={3}
            placeholder="Data Source=...;User ID=...;Password=...;Encrypt=True"
            autoComplete="off"
            spellCheck={false}
            {...form.register("connectionString")}
          />
          <label className="block text-xs font-medium">Password (if masked)</label>
          <Input type="password" autoComplete="off" {...form.register("password")} />
        </>
      ) : (
        <>
          <label className="block text-xs font-medium">Host</label>
          <Input placeholder="host" autoComplete="off" {...form.register("host")} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium">Port</label>
              <Input placeholder="3306" autoComplete="off" {...form.register("port")} />
            </div>
            <div>
              <label className="block text-xs font-medium">Username</label>
              <Input placeholder="root" autoComplete="off" {...form.register("username")} />
            </div>
          </div>
          <label className="block text-xs font-medium">Password</label>
          <Input type="password" autoComplete="off" {...form.register("password")} />
        </>
      )}
      <label className="block text-xs font-medium">Database name (optional)</label>
      <Input
        placeholder="Leave blank to pick from the server list"
        autoComplete="off"
        {...form.register("databaseName")}
      />
      <p className="text-[11px] text-slate-500">
        Credentials stay on this server. Never sent to the AI. SQL is read-only.
      </p>
      <Button type="submit" size="sm" disabled={connect.isPending}>
        <PlugZap className="h-3.5 w-3.5" />
        {connect.isPending ? "Connecting…" : "Save & connect"}
      </Button>
    </form>
  );
}

export function QuickBooksConnectCard() {
  const [qbPending, setQbPending] = useState(false);

  return (
    <div className="space-y-2.5">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Connect a QuickBooks Online company via Intuit OAuth. Kept separate from databases — use the header
        picker to chat with QB or a DB.
      </p>
      <p className="text-[11px] text-slate-500">
        Needs QUICKBOOKS_CLIENT_ID / SECRET in server/.env. Redirect: http://localhost:4000/api/quickbooks/callback
      </p>
      <Button
        type="button"
        size="sm"
        disabled={qbPending}
        onClick={async () => {
          try {
            setQbPending(true);
            const { url } = await api<{ url: string }>("/quickbooks/connect");
            window.location.href = url;
          } catch (error) {
            const err = error instanceof ApiError ? error : new ApiError("Unable to start QuickBooks connect.");
            toast.error(err.message, { description: err.hints.join(" · ") });
            setQbPending(false);
          }
        }}
      >
        <PlugZap className="h-3.5 w-3.5" />
        {qbPending ? "Redirecting…" : "Connect QuickBooks"}
      </Button>
    </div>
  );
}

export function OutlookConnectCard() {
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-2.5">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Connect Microsoft 365 Outlook via Entra OAuth. Ask the chat for today&apos;s mail summary, unread
        highlights, or action items.
      </p>
      <p className="text-[11px] text-slate-500">
        Needs MICROSOFT_CLIENT_ID / SECRET in server/.env. Redirect:{" "}
        http://localhost:4000/api/auth/microsoft/callback
      </p>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={async () => {
          try {
            setPending(true);
            const { url } = await api<{ url: string }>("/outlook/connect");
            window.location.href = url;
          } catch (error) {
            const err = error instanceof ApiError ? error : new ApiError("Unable to start Outlook connect.");
            toast.error(err.message, { description: err.hints.join(" · ") });
            setPending(false);
          }
        }}
      >
        <PlugZap className="h-3.5 w-3.5" />
        {pending ? "Redirecting…" : "Connect Outlook"}
      </Button>
    </div>
  );
}
