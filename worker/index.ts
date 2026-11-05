import handler from "vinext/server/fetch-handler";

// Independent hosting: client-supplied Sites identity headers grant no privileges.
export default {
  fetch(request:Request, env:Cloudflare.Env, ctx:ExecutionContext){
    const headers=new Headers(request.headers);
    for(const name of [...headers.keys()])if(name.toLowerCase().startsWith("oai-authenticated-"))headers.delete(name);
    return handler.fetch(new Request(request,{headers}),env,ctx);
  }
};
