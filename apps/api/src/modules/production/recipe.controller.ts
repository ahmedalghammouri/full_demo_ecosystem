import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { RecipeService, CreateRecipeDto, RecipeIngredientDto } from './recipe.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RecipeStatus } from '@prisma/client';

interface RequestUser { id: string; factoryId: string | null; }

@ApiTags('Production - Recipes')
@ApiBearerAuth('JWT-auth')
@Controller('production/recipes')
export class RecipeController {
  constructor(private readonly recipeService: RecipeService) {}

  // ── List ─────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List recipes with optional filters' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: RecipeStatus })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('skuId') skuId?: string,
    @Query('status') status?: RecipeStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.recipeService.findAll(user.factoryId, {
      search,
      skuId,
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  // ── Single ───────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get recipe by ID with ingredients and cost estimate' })
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.recipeService.findById(user.factoryId, id);
  }

  // ── Create ───────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new recipe (DRAFT)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateRecipeDto) {
    return this.recipeService.create(user.factoryId, dto);
  }

  // ── Update ───────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({ summary: 'Update recipe fields (blocked for APPROVED/OBSOLETE)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateRecipeDto>,
  ) {
    return this.recipeService.update(user.factoryId, id, dto);
  }

  // ── Delete ───────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a DRAFT recipe' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.recipeService.delete(user.factoryId, id);
  }

  // ── Status transitions ───────────────────────────────────────

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit recipe for review (DRAFT → REVIEW)' })
  submitForReview(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.recipeService.submitForReview(user.factoryId, id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve recipe (REVIEW → APPROVED)' })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.recipeService.approve(user.factoryId, id, user.id);
  }

  @Post(':id/obsolete')
  @ApiOperation({ summary: 'Mark recipe obsolete (APPROVED → OBSOLETE)' })
  obsolete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.recipeService.obsolete(user.factoryId, id);
  }

  // ── Clone ────────────────────────────────────────────────────

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone recipe to a new version (always creates DRAFT)' })
  clone(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body('version') version: string,
  ) {
    return this.recipeService.clone(user.factoryId, id, version);
  }

  // ── Ingredient management ────────────────────────────────────

  @Post(':id/ingredients')
  @ApiOperation({ summary: 'Add a raw material ingredient to the recipe' })
  addIngredient(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Body() dto: RecipeIngredientDto,
  ) {
    return this.recipeService.addIngredient(user.factoryId, recipeId, dto);
  }

  @Patch(':id/ingredients/:ingredientId')
  @ApiOperation({ summary: 'Update an ingredient (quantity, scrapFactor, etc.)' })
  updateIngredient(
    @Param('ingredientId') ingredientId: string,
    @Body() dto: Partial<RecipeIngredientDto>,
  ) {
    return this.recipeService.updateIngredient(ingredientId, dto);
  }

  @Delete(':id/ingredients/:ingredientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an ingredient from the recipe' })
  async removeIngredient(@Param('ingredientId') ingredientId: string) {
    await this.recipeService.removeIngredient(ingredientId);
  }
}
